import { useEffect, useRef, useState } from 'react'
import * as api from '@api'
import { legalActions, nextActive } from '../engine/game.js'
import { TURN_MS } from '../server/rooms.js'
import { displayName } from '../api/shared.js'
import { CPU_NAMES, roomTitle } from '../roomText.js'
import Table from './Table.jsx'
import Avatar from './Avatar.jsx'

/** Sala online: espera de jugadores y mesa. `room` es mi vista (llega en tiempo real). */
export default function OnlineRoom({ room, profile, people, onBack, onView }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bubbles, setBubbles] = useState({})
  const seen = useRef({ handNo: null, len: 0 })
  const [optimistic, setOptimistic] = useState(null) // jugada propia mostrada antes de que conteste el servidor
  const [deadline, setDeadline] = useState(null)

  // Cada vez que cambia la partida arranca el tiempo de la jugada siguiente
  useEffect(() => {
    setOptimistic(null)
    setDeadline(room.status === 'playing' ? Date.now() + TURN_MS : null)
  }, [room.version, room.status])

  // Por si se pierde un aviso en tiempo real: cada 4 segundos se fija si hay algo nuevo
  useEffect(() => {
    if (room.status !== 'playing' && room.status !== 'waiting') return
    const id = setInterval(() => {
      api
        .getRoomView(room.id, profile.id)
        .then((v) => v && v.version > room.version && onView(v))
        .catch(() => {})
    }, 4000)
    return () => clearInterval(id)
  }, [room.id, room.version, room.status, profile.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const expire = () => {
    // Se acabó el tiempo: le pedimos al servidor que juegue la compu por quien no jugó
    api
      .timeoutRoom(room.id)
      .then((v) => onView(v))
      .catch(() => setDeadline(Date.now() + 2500)) // si el otro ya lo pidió, o todavía hay unos segundos, reintenta
  }

  const names = room.seats.map((s, i) => {
    if (i === room.mySeat) return 'Vos'
    if (s.type === 'cpu') return CPU_NAMES[i]
    if (s.type === 'open') return 'Libre'
    const p = people[s.userId]
    return p ? p.first_name || p.username : 'Jugador'
  })

  // Globitos: cuando alguien corta o se le acaba el tiempo
  const log = room.match?.log ?? []
  const handNo = room.match?.handNo
  useEffect(() => {
    const prev = seen.current
    const start = prev.handNo === handNo ? prev.len : 0
    const fresh = log.slice(start).filter((e) => ['cut', 'timeout'].includes(e.t))
    seen.current = { handNo, len: log.length }
    if (prev.handNo === null) return // al abrir la sala no repetimos lo viejo
    for (const e of fresh) {
      if (e.seat === room.mySeat) continue
      const text = e.t === 'cut' ? '¡Corto!' : 'Se le acabó el tiempo'
      const id = Math.random()
      setBubbles((b) => ({ ...b, [e.seat]: { text, id } }))
      setTimeout(() => setBubbles((b) => (b[e.seat]?.id === id ? { ...b, [e.seat]: undefined } : b)), 2200)
    }
  }, [log.length, handNo]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setOptimistic(null)
      setError(e.message)
      setTimeout(() => setError(''), 3500)
    } finally {
      setBusy(false)
    }
  }

  // ----- Sala de espera -----
  if (room.status === 'waiting') {
    const isHost = room.hostId === profile.id
    const mine = room.seats[room.mySeat]
    const invitedNotJoined = mine?.type === 'user' && !mine.joined
    return (
      <main className="lobby">
        <button className="back" onClick={onBack}>
          ‹ Volver
        </button>
        <h2 className="page-title">{roomTitle(room.players)}</h2>
        <p className="code-line">
          Código de la sala: <b className="code">{room.code}</b>
        </p>
        <ul className="lobby-seats">
          {room.seats.map((s, i) => (
            <li key={i} className="lobby-seat">
              <Avatar profile={s.type === 'user' ? people[s.userId] : { username: s.type === 'cpu' ? CPU_NAMES[i] : '?' }} size={38} />
              <span className="person-text">
                <b>{i === room.mySeat ? 'Vos' : s.type === 'cpu' ? CPU_NAMES[i] : s.type === 'open' ? 'Lugar libre' : displayName(people[s.userId])}</b>
                <span className="muted">{s.type === 'cpu' ? 'La compu' : i === room.hostId ? '' : ''}</span>
              </span>
              <span className={`tag ${s.type === 'cpu' || s.joined ? 'tag-ok' : ''}`}>
                {s.type === 'cpu' ? 'Lista' : s.type === 'open' ? 'Con el código' : s.joined ? 'Adentro' : 'Invitado'}
              </span>
            </li>
          ))}
        </ul>
        {error && <p className="form-error">{error}</p>}
        {invitedNotJoined ? (
          <div className="sheet-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.joinRoom({ roomId: room.id }))}>
              Entrar a jugar
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => run(async () => (await api.declineRoom(room.id), onBack()))}>
              No puedo
            </button>
          </div>
        ) : (
          <>
            <p className="muted">Esperando a que entren todos. La partida arranca sola cuando estén.</p>
            {isHost && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.startRoom(room.id))}>
                Arrancar ya, la compu completa
              </button>
            )}
          </>
        )}
      </main>
    )
  }

  if (room.status === 'cancelled') {
    return (
      <main className="lobby">
        <h2 className="page-title">Partida cancelada</h2>
        <p className="muted">Se fueron todos de la partida.</p>
        <button className="btn btn-primary" onClick={() => (api.dismissRoom(room.id), onBack())}>
          Volver al inicio
        </button>
      </main>
    )
  }

  const match = optimistic?.version === room.version ? optimistic.match : room.match
  const actions = busy || optimistic ? [] : legalActions(match, room.mySeat)
  const send = (a) => {
    // Tirar y levantar del pozo se muestran al instante; el servidor confirma enseguida
    const guess = predict(room.match, room.mySeat, a)
    if (guess) setOptimistic({ version: room.version, match: guess })
    run(async () => onView(await api.actRoom(room.id, a)))
  }
  return (
    <>
      {error && <p className="form-error floating">{error}</p>}
      <Table
        view={match}
        me={room.mySeat}
        actions={actions}
        names={names}
        bubbles={bubbles}
        onAct={send}
        onNextHand={() => run(() => api.actRoom(room.id, { type: 'next' }).then(onView).catch(() => {}))}
        timer={{ deadline, total: TURN_MS, onExpire: expire }}
        onRestart={null}
        onQuit={() => (room.status === 'finished' ? (api.dismissRoom(room.id), onBack()) : onBack())}
        onLeave={room.status === 'playing' ? () => run(async () => (await api.actRoom(room.id, { type: 'leave' }), api.dismissRoom(room.id), onBack())) : null}
        onBack={onBack}
      />
    </>
  )
}

/** Mi jugada aplicada a mi vista, para mostrarla antes de que conteste el servidor. */
function predict(view, seat, a) {
  const v = JSON.parse(JSON.stringify(view))
  const h = v.hand
  if (a.type === 'discard') {
    h.mine = h.mine.filter((c) => c !== a.card)
    h.counts[seat] = h.mine.length
    h.discardTop = a.card
    h.discardCount++
    h.phase = 'draw'
    h.drawnFromDiscard = null
    h.turn = nextActive(v, seat)
    v.log = [...v.log, { t: 'discard', seat, card: a.card }]
    return v
  }
  if (a.type === 'draw' && a.from === 'discard' && h.discardTop) {
    h.mine = [...h.mine, h.discardTop]
    h.counts[seat] = h.mine.length
    h.drawnFromDiscard = h.discardTop
    h.discardTop = null
    h.discardCount--
    h.phase = 'discard'
    return v
  }
  return null
}
