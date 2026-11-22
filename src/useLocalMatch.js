// Partida contra la compu: el jugador es el asiento 0; el resto juega la IA.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createMatch, deal, apply, legalActions, viewFor } from './engine/game.js'
import { chooseAction } from './engine/ai.js'
import { TURN_MS } from './server/rooms.js'

const KEY = 'chinchon.local'
const ME = 0
export const LOCAL_NAMES = ['Vos', 'Beto', 'Chela', 'Ramón', 'Pocha', 'Tito']

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    return s?.match ? s : null
  } catch {
    return null
  }
}
function save(state) {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state))
    else localStorage.removeItem(KEY)
  } catch {
    /* sin storage */
  }
}

export const savedLocalMatch = () => load()

export function useLocalMatch(initial) {
  const [match, setMatch] = useState(() => initial)
  const [bubbles, setBubbles] = useState({})
  const timer = useRef(null)

  useEffect(() => save(match ? { match } : null), [match])

  const say = (seat, text) => {
    const id = Math.random()
    setBubbles((b) => ({ ...b, [seat]: { text, id } }))
    setTimeout(() => setBubbles((b) => (b[seat]?.id === id ? { ...b, [seat]: undefined } : b)), 2200)
  }

  const act = useCallback((seat, action) => {
    setMatch((m) => {
      try {
        return apply(m, seat, action)
      } catch {
        return m
      }
    })
    if (seat !== ME && action.type === 'cut') say(seat, '¡Corto!')
  }, [])

  // Turno de la compu: roba y tira con una pausa, para que se vea qué hace
  useEffect(() => {
    clearTimeout(timer.current)
    if (!match?.hand || match.hand.finished || match.winner !== null) return
    const seat = match.hand.turn
    if (seat === ME && !match.out[ME]) return
    timer.current = setTimeout(
      () => {
        const a = chooseAction(viewFor(match, seat), seat)
        if (a) act(seat, a)
      },
      match.hand.phase === 'draw' ? 650 : 850
    )
    return () => clearTimeout(timer.current)
  }, [match, act])

  // Tiempo para jugar: si se acaba, la compu juega por vos
  const myTurnKey = match && legalActions(match, ME).length ? `${match.handNo}-${match.moves ?? match.log.length}` : null
  const [deadline, setDeadline] = useState(null)
  useEffect(() => setDeadline(myTurnKey ? Date.now() + TURN_MS : null), [myTurnKey])
  const expire = () => {
    if (!match || !legalActions(match, ME).length) return
    const a = chooseAction(viewFor(match, ME), ME)
    if (a) act(ME, a)
  }
  const turnTimer = { deadline, total: TURN_MS, onExpire: expire }

  const nextHand = () => setMatch((m) => deal(m))
  const restart = (players, limit) => setMatch(deal(createMatch({ players, limit })))
  const quit = () => setMatch(null)

  return { match, view: match ? viewFor(match, ME) : null, me: ME, act, bubbles, nextHand, restart, quit, timer: turnTimer }
}
