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

