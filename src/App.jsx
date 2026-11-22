import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '@api'
import { legalActions } from './engine/game.js'
import { useLocalMatch, savedLocalMatch, LOCAL_NAMES } from './useLocalMatch.js'
import { roomTitle } from './roomText.js'
import { displayName } from './api/shared.js'
import Table from './components/Table.jsx'
import Login from './components/Login.jsx'
import Friends from './components/Friends.jsx'
import NewOnline from './components/NewOnline.jsx'
import OnlineRoom from './components/OnlineRoom.jsx'
import Avatar from './components/Avatar.jsx'
import { useNotifications, Toast, Bell } from './components/Notifications.jsx'

const PROFILE_KEY = 'chinchon.profile'

export default function App() {
  const [user, setUser] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    api.getSessionUser().then(setUser)
    return api.onAuthChange(setUser)
  }, [])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      return
    }
    api
      .getProfile(user.id)
      .then((p) => {
        setProfile(p)
        try {
          localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
        } catch {
          /* nada */
        }
      })
      .catch(() => {
        // Sin conexión: el último perfil usado alcanza para jugar contra la compu
        try {
          const p = JSON.parse(localStorage.getItem(PROFILE_KEY))
          if (p?.id === user.id) setProfile(p)
        } catch {
          /* nada */
        }
      })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (user === undefined || (user && !profile)) return <Splash />
  if (!user) return <Login />
  return <Main profile={profile} setProfile={setProfile} />
}

function Splash() {
  return (
    <div className="screen splash">
      <h1 className="title">Chinchón</h1>
    </div>
  )
}

function Main({ profile, setProfile }) {
  const [screen, setScreen] = useState({ name: 'home' })
  const go = (name, extra = {}) => setScreen({ name, ...extra })

  // Partida contra la compu (se guarda en el celular)
  const [initialLocal] = useState(() => savedLocalMatch()?.match ?? null)
  const local = useLocalMatch(initialLocal)
  const [localPlayers, setLocalPlayers] = useState(() => initialLocal?.players ?? 2)

  // Amigos
  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [] })
  const reloadFriends = useCallback(() => api.friendsData(profile.id).then(setFriends).catch(() => {}), [profile.id])
  useEffect(() => {
    reloadFriends()
    const t = setInterval(reloadFriends, 20000)
    const unsub = api.subscribeFriendships(profile.id, () => reloadFriends())
    return () => {
      clearInterval(t)
      unsub()
    }
  }, [reloadFriends, profile.id])

  // Partidas online: lista inicial + cambios en tiempo real
  const [rooms, setRooms] = useState({})
  const [people, setPeople] = useState({ [profile.id]: profile })
  const upsertRoom = useCallback(
    (v) => v && setRooms((r) => (r[v.id] && r[v.id].version > v.version ? r : { ...r, [v.id]: v })),
    []
  )
  useEffect(() => {
    const upsert = upsertRoom
    api
      .myRooms(profile.id)
      .then((list) => setRooms(Object.fromEntries(list.map((v) => [v.id, v]))))
      .catch(() => {})
    return api.subscribeRooms(profile.id, upsert)
  }, [profile.id])

  // Nombres y fotos de quienes aparecen en las salas
  const roomUserIds = useMemo(
    () => [...new Set(Object.values(rooms).flatMap((r) => r.seats.filter((s) => s.userId).map((s) => s.userId)))],
    [rooms]
  )
  useEffect(() => {
    const missing = roomUserIds.filter((id) => !people[id])
    if (missing.length)
      api.profilesByIds(missing).then((ps) => setPeople((p) => ({ ...p, ...Object.fromEntries(ps.map((x) => [x.id, x])) })))
  }, [roomUserIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notificaciones (aviso arriba + campanita)
  const notif = useNotifications({ profile, friends, rooms: Object.values(rooms), people })
  const notifHandlers = {
    onAcceptFriend: (id) => api.acceptFriend(id).then(reloadFriends).catch(() => {}),
    onRejectFriend: (id) => api.removeFriendship(id).then(reloadFriends).catch(() => {}),
    onOpenRoom: (id) => go('room', { roomId: id }),
  }
  const withToast = (node) => (
    <>
      {node}
      <Toast notif={notif} {...notifHandlers} />
    </>
  )

  const openRoom = (view) => {
    setRooms((r) => ({ ...r, [view.id]: view }))
    go('room', { roomId: view.id })
  }

  // ----- Pantallas -----
  if (screen.name === 'local' && local.match) {
    const n = local.match.players
    return withToast(
      <div className="screen">
        <Table
          view={local.view}
          me={local.me}
          actions={legalActions(local.match, local.me)}
          names={LOCAL_NAMES.slice(0, n)}
          bubbles={local.bubbles}
          onAct={(a) => local.act(local.me, a)}
          onNextHand={local.nextHand}
          onRestart={() => local.restart(n)}
          onQuit={() => (local.quit(), go('home'))}
          onBack={() => go('home')}
          timer={local.timer}
        />
      </div>
    )
  }

  if (screen.name === 'room' && rooms[screen.roomId]) {
    return withToast(
      <div className="screen">
        <OnlineRoom
          room={rooms[screen.roomId]}
          profile={profile}
          people={people}
          onView={upsertRoom}
          onBack={() => go('home')}
        />
      </div>
    )
  }

  if (screen.name === 'friends') {
    return withToast(
      <div className="screen">
        <Friends
          profile={profile}
          data={friends}
          reload={reloadFriends}
          onPlayWith={(p) => go('new', { preset: p })}
          onBack={() => go('home')}
        />
      </div>
    )
  }

  if (screen.name === 'new') {
    return withToast(
      <div className="screen">
        <NewOnline
          friends={friends.friends}
          preset={screen.preset}
          onCreate={async (opts) => openRoom(await api.createRoom(opts))}
          onBack={() => go('home')}
        />
      </div>
    )
  }

  if (screen.name === 'profile') {
    return withToast(
      <div className="screen">
        <Profile profile={profile} onChange={setProfile} onBack={() => go('home')} />
      </div>
    )
  }

  return withToast(
    <div className="screen">
      <Home
        profile={profile}
        friends={friends}
        rooms={Object.values(rooms)}
        local={local}
        localPlayers={localPlayers}
        setLocalPlayers={setLocalPlayers}
        onLocal={(players) => (local.restart(players), go('local'))}
        onResumeLocal={() => go('local')}
        onFriends={() => go('friends')}
        onNew={() => go('new')}
        onProfile={() => go('profile')}
        onOpenRoom={(id) => go('room', { roomId: id })}
        onJoinCode={async (code) => openRoom(await api.joinRoom({ code }))}
        people={people}
        notif={notif}
        notifHandlers={notifHandlers}
      />
    </div>
  )
}

function Home({ profile, friends, rooms, local, localPlayers, setLocalPlayers, onLocal, onResumeLocal, onFriends, onNew, onProfile, onOpenRoom, onJoinCode, people, notif, notifHandlers }) {
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const invites = rooms.filter((r) => r.status === 'waiting' && r.seats[r.mySeat]?.type === 'user' && !r.seats[r.mySeat].joined)
  const active = rooms.filter((r) => !invites.includes(r) && ['waiting', 'playing'].includes(r.status))
  const finished = rooms.filter((r) => r.status === 'finished').slice(0, 3)
  const hostName = (r) => {
    const p = people[r.hostId]
    return p ? displayName(p) : 'Un amigo'
  }
  const localOn = local.match && local.match.winner === null

  return (
    <main className="home">
      <header className="home-top">
        <h1 className="title title-small">Chinchón</h1>
        <span className="top-actions">
          <Bell notif={notif} {...notifHandlers} />
          <button className="me" onClick={onProfile} aria-label="Mi perfil">
            <Avatar profile={profile} size={40} />
          </button>
        </span>
      </header>
      <p className="greeting">Hola, {profile.first_name || profile.username}. ¿Unas manos de chinchón?</p>

      {invites.length > 0 && (
        <section className="panel invites">
          <h3>Te invitaron</h3>
          {invites.map((r) => (
            <button key={r.id} className="room-row is-invite" onClick={() => onOpenRoom(r.id)}>
              <span>
                <b>{hostName(r)}</b> te invitó: {roomTitle(r.players).toLowerCase()}
              </span>
              <span className="tag tag-gold">Ver</span>
            </button>
          ))}
        </section>
      )}

      <section className="block">
        <h2>Con amigos</h2>
        <div className="mode-grid">
          <button className="mode mode-friends" onClick={onNew}>
            <span className="mode-title">Nueva partida</span>
            <span className="mode-sub">Invitá amigos o compartí el código</span>
          </button>
          <button className="mode mode-friends" onClick={onFriends}>
            <span className="mode-title">
              Amigos{friends.incoming.length > 0 && <span className="badge">{friends.incoming.length}</span>}
            </span>
            <span className="mode-sub">
              {friends.friends.length ? `${friends.friends.length} agregados` : 'Buscá y agregá jugadores'}
            </span>
          </button>
        </div>
        <form
          className="code-join"
          onSubmit={async (e) => {
            e.preventDefault()
            setCodeError('')
            try {
              await onJoinCode(code.trim())
            } catch (err) {
              setCodeError(err.message)
            }
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Código de sala"
            maxLength={5}
            autoCapitalize="characters"
            autoCorrect="off"
          />
          <button className="btn btn-ghost" disabled={code.trim().length < 5}>
            Unirme
          </button>
        </form>
        {codeError && <p className="form-error">{codeError}</p>}
        {active.length > 0 && (
          <div className="room-list">
            {active.map((r) => (
              <button key={r.id} className="room-row" onClick={() => onOpenRoom(r.id)}>
                <span>
                  {roomTitle(r.players)}{' '}
                  <span className="muted">
                    {r.status === 'waiting'
                      ? `esperando jugadores (${r.code})`
                      : `vas con ${r.match?.scores[r.mySeat] ?? 0}${r.match?.hand?.turn === r.mySeat && !r.match?.hand?.finished ? ' · te toca' : ''}`}
                  </span>
                </span>
                <span className="tag tag-gold">{r.status === 'waiting' ? 'Sala' : 'Seguir'}</span>
              </button>
            ))}
          </div>
        )}
        {finished.length > 0 && (
          <p className="muted small">
            Últimas: {finished.map((r) => (r.match.winner === r.mySeat ? 'ganaste' : 'perdiste')).join(', ')}
          </p>
        )}
      </section>

      <section className="block">
        <h2>Contra la compu</h2>
        {localOn && (
          <button className="room-row" onClick={onResumeLocal}>
            <span>
              Seguir partida <span className="muted">vas con {local.match.scores[0]}</span>
            </span>
            <span className="tag tag-gold">Seguir</span>
          </button>
        )}
        <p className="field-label">¿Cuántos juegan? (vos y la compu)</p>
        <div className="segmented segmented-6" role="tablist">
          {[2, 3, 4, 5, 6].map((k) => (
            <button key={k} role="tab" aria-selected={localPlayers === k} onClick={() => setLocalPlayers(k)}>
              {k}
            </button>
          ))}
        </div>
        <button className="mode mode-wide" onClick={() => onLocal(localPlayers)}>
          <span className="mode-title">{localOn ? 'Nueva partida' : 'Jugar'}</span>
          <span className="mode-sub">
            {localPlayers === 2 ? 'Mano a mano contra la compu' : `Vos contra ${LOCAL_NAMES.slice(1, localPlayers).join(', ').replace(/, ([^,]*)$/, ' y $1')}`}
          </span>
        </button>
      </section>
    </main>
  )
}

function Profile({ profile, onChange, onBack }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const onPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setMsg('')
    try {
      onChange(await api.uploadAvatar(profile.id, file))
      setMsg('Foto actualizada.')
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="profile">
      <button className="back" onClick={onBack}>
        ‹ Volver
      </button>
      <label className="photo-btn">
        <Avatar profile={profile} size={112} />
        <span className="photo-badge">{busy ? '…' : '📷'}</span>
        <input type="file" accept="image/*" hidden onChange={onPhoto} />
      </label>
      <h2 className="page-title center">{displayName(profile)}</h2>
      <p className="muted center">@{profile.username}</p>
      {msg && <p className="muted center">{msg}</p>}
      <p className="muted small center">Es la misma cuenta que el Sudoku y el Truco: la foto y el nombre se ven en todos los juegos.</p>
      <button className="btn btn-ghost" onClick={() => api.signOut()}>
        Cerrar sesión
      </button>
      <p className="credits">
        Naipes: dibujos de{' '}
        <a href="https://commons.wikimedia.org/wiki/User:Basquetteur" target="_blank" rel="noreferrer">
          Basquetteur
        </a>{' '}
        (Wikimedia Commons), con licencia{' '}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/deed.es" target="_blank" rel="noreferrer">
          CC BY-SA 3.0
        </a>
        . Adaptados a imágenes livianas. El comodín es un dibujo propio.
      </p>
    </main>
  )
}

