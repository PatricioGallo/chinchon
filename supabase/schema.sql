-- Chinchón: usa la misma base que el Sudoku y el Truco.
-- Las cuentas (auth + profiles) y los amigos (friendships) ya existen y se comparten;
-- acá solo van las tablas de las partidas de chinchón.

-- Partidas: el estado completo (con todas las cartas) solo lo toca el servidor ------
create table if not exists public.chinchon_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid not null references public.profiles (id) on delete cascade,
  status text not null,
  state jsonb not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS activado y sin políticas: desde la app no se puede leer ni escribir
alter table public.chinchon_rooms enable row level security;

-- Lo que ve cada jugador (sus cartas, nunca las ajenas) ----------------------
create table if not exists public.chinchon_views (
  room_id uuid not null references public.chinchon_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  view jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists chinchon_views_user on public.chinchon_views (user_id, updated_at desc);

alter table public.chinchon_views enable row level security;

drop policy if exists "ver mi vista" on public.chinchon_views;
create policy "ver mi vista" on public.chinchon_views
  for select using (auth.uid() = user_id);

-- Avisos en tiempo real cuando cambia la vista de un jugador
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chinchon_views'
  ) then
    alter publication supabase_realtime add table public.chinchon_views;
  end if;
end $$;

-- Guarda la sala y las vistas de los jugadores en una sola llamada (más rápido)
create or replace function public.chinchon_save(
  p_id uuid, p_code text, p_host uuid, p_status text, p_state jsonb,
  p_version integer, p_prev integer, p_views jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_prev is null then
    insert into chinchon_rooms (id, code, host_id, status, state, version)
    values (p_id, p_code, p_host, p_status, p_state, p_version);
  else
    update chinchon_rooms
      set status = p_status, state = p_state, version = p_version, updated_at = now()
      where id = p_id and version = p_prev;
    if not found then return false; end if;
  end if;
  insert into chinchon_views (room_id, user_id, view, version, updated_at)
    select p_id, (v ->> 'user_id')::uuid, v -> 'view', p_version, now()
    from jsonb_array_elements(p_views) v
  on conflict (room_id, user_id) do update
    set view = excluded.view, version = excluded.version, updated_at = now();
  return true;
end;
$$;

revoke execute on function public.chinchon_save(uuid, text, uuid, text, jsonb, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.chinchon_save(uuid, text, uuid, text, jsonb, integer, integer, jsonb) to service_role;

-- Ranking de chinchón ---------------------------------------------------------
-- Cuando una partida online termina, se anota el resultado de cada persona.
-- Puntos: ganar = 10 por cada rival (persona) vencido; +10 si ganó con chinchón;
-- +5 si ganó sin reengancharse; terminar la partida perdiendo = 1; abandonar = 0.
-- Solo cuentan partidas con al menos 2 personas, y como mucho 3 victorias por día
-- contra el mismo rival (las siguientes cuentan como victoria pero no suman por ese rival).

create table if not exists public.chinchon_results (
  id bigserial primary key,
  room_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  won boolean not null,
  abandoned boolean not null default false,
  chinchon boolean not null default false,
  players integer not null,
  rivals uuid[] not null default '{}',
  points integer not null,
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists chinchon_results_user on public.chinchon_results (user_id, created_at desc);
create index if not exists chinchon_results_date on public.chinchon_results (created_at desc);

alter table public.chinchon_results enable row level security;
drop policy if exists "ver mis resultados" on public.chinchon_results;
create policy "ver mis resultados" on public.chinchon_results
  for select using (auth.uid() = user_id);

create or replace function public.chinchon_record_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st jsonb := new.state;
  seats jsonb := st -> 'seats';
  m jsonb := st -> 'match';
  w integer;
  i integer;
  s jsonb;
  humans uuid[] := '{}';
  present uuid[] := '{}';
  wuid uuid;
  r uuid;
  elig integer := 0;
  is_ch boolean;
  reeng boolean;
  pts integer;
  n integer := coalesce((st ->> 'players')::integer, 2);
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
begin
  if new.status <> 'finished' or (tg_op = 'UPDATE' and old.status = 'finished') then return new; end if;
  if m is null or jsonb_typeof(m -> 'winner') is distinct from 'number' then return new; end if;
  w := (m ->> 'winner')::integer;

  for i in 0 .. jsonb_array_length(seats) - 1 loop
    s := seats -> i;
    if s ->> 'type' = 'user' then
      present := present || (s ->> 'userId')::uuid;
      humans := humans || (s ->> 'userId')::uuid;
    elsif s ->> 'type' = 'cpu' and s ? 'leftBy' then
      humans := humans || (s ->> 'leftBy')::uuid;
    end if;
  end loop;
  select coalesce(array_agg(distinct x), '{}') into humans from unnest(humans) x;
  -- Contra la compu sola no cuenta
  if coalesce(array_length(humans, 1), 0) < 2 then return new; end if;

  if seats -> w ->> 'type' = 'user' then wuid := (seats -> w ->> 'userId')::uuid; end if;

  if wuid is not null then
    foreach r in array humans loop
      continue when r = wuid;
      if (select count(*) from chinchon_results c
          where c.user_id = wuid and c.won and c.created_at >= day_start and r = any (c.rivals)) < 3 then
        elig := elig + 1;
      end if;
    end loop;
    is_ch := coalesce((m -> 'hand' -> 'result' ->> 'chinchon')::boolean, false)
             and (m -> 'hand' -> 'result' ->> 'cutter')::integer = w;
    reeng := coalesce((m -> 'reenganche' ->> w)::boolean, false);
    pts := 10 * elig
           + case when elig > 0 and is_ch then 10 else 0 end
           + case when elig > 0 and not reeng then 5 else 0 end;
    insert into chinchon_results (room_id, user_id, won, chinchon, players, rivals, points)
    values (new.id, wuid, true, is_ch, n, array_remove(humans, wuid), pts)
    on conflict (room_id, user_id) do nothing;
  end if;

  foreach r in array humans loop
    continue when r = wuid;
    insert into chinchon_results (room_id, user_id, won, abandoned, players, rivals, points)
    values (new.id, r, false, not (r = any (present)), n, array_remove(humans, r),
            case when r = any (present) then 1 else 0 end)
    on conflict (room_id, user_id) do nothing;
  end loop;
  return new;
end;
$$;

revoke execute on function public.chinchon_record_result() from public, anon, authenticated;

drop trigger if exists chinchon_rooms_result on public.chinchon_rooms;
create trigger chinchon_rooms_result
  after insert or update of status on public.chinchon_rooms
  for each row execute function public.chinchon_record_result();

-- Ranking: p_scope 'global' | 'friends', p_period 'month' | 'all'.
-- Devuelve los primeros lim y, aparte, la fila de quien consulta aunque esté más abajo.
create or replace function public.chinchon_ranking(p_scope text default 'global', p_period text default 'month', lim integer default 50)
returns table (pos bigint, user_id uuid, username text, first_name text, last_name text, avatar_url text,
               points bigint, wins bigint, played bigint)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id),
  friends as (
    select case when f.requester = me.id then f.addressee else f.requester end as id
    from friendships f, me
    where f.status = 'accepted' and me.id in (f.requester, f.addressee)
    union select id from me
  ),
  agg as (
    select c.user_id, sum(c.points)::bigint as points,
           count(*) filter (where c.won)::bigint as wins, count(*)::bigint as played
    from chinchon_results c
    where p_period = 'all'
       or c.created_at >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires'
    group by c.user_id
  ),
  base as (
    select p.id, p.username, p.first_name, p.last_name, p.avatar_url,
           coalesce(a.points, 0) as points, coalesce(a.wins, 0) as wins, coalesce(a.played, 0) as played
    from profiles p
    left join agg a on a.user_id = p.id
    where (p_scope = 'friends' and p.id in (select id from friends))
       or (p_scope <> 'friends' and a.user_id is not null)
  ),
  ranked as (
    select rank() over (order by b.points desc, b.wins desc) as pos, b.*
    from base b
  )
  select r.pos, r.id, r.username, r.first_name, r.last_name, r.avatar_url, r.points, r.wins, r.played
  from ranked r
  where r.pos <= lim or r.id = (select id from me)
  order by r.pos, r.username;
$$;

revoke execute on function public.chinchon_ranking(text, text, integer) from public, anon;
grant execute on function public.chinchon_ranking(text, text, integer) to authenticated;
