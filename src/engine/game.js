// Reglas del chinchón. El estado es JSON puro: se guarda tal cual en el celular o en el servidor.
//
// Cada turno: se roba una carta (del mazo o la de arriba del pozo) y se tira una.
// En vez de tirar, se puede cortar si lo que queda sin combinar suma 5 o menos.
// Al cortar, todos bajan sus combinaciones; los demás pueden pegar cartas a las de quien cortó.
// Suma lo que queda suelto. Cortar sin nada suelto: -10. Chinchón (7 seguidas del mismo palo,
// sin comodín): gana la partida. Quien pasa los 100 queda afuera, salvo que se reenganche
// (una vez por jugador): vuelve con el puntaje más alto de los que siguen.

import { newDeck, shuffle, bestMelds, attachCards, isChinchon, cardPoints } from './cards.js'

export const CUT_MAX = 5
export const HAND_SIZE = 7
const LOG_MAX = 40

const clone = (x) => JSON.parse(JSON.stringify(x))
const push = (m, entry) => {
  m.log.push(entry)
  if (m.log.length > LOG_MAX) m.log.splice(0, m.log.length - LOG_MAX)
}

export function createMatch({ players = 2, limit = 100 } = {}) {
  if (players < 2 || players > 6) throw new Error('Se juega de 2 a 6')
  return {
    players,
    limit,
    scores: Array(players).fill(0),
    out: Array(players).fill(false),
    reenganche: Array(players).fill(false),
    dealer: players - 1,
    handNo: 0,
    hand: null,
    log: [],
    winner: null,
  }
}

export const activeSeats = (m) => [...Array(m.players).keys()].filter((s) => !m.out[s])
export function nextActive(m, seat) {
  for (let i = 1; i <= m.players; i++) {
    const s = (seat + i) % m.players
    if (!m.out[s]) return s
  }
  return seat
}

/** Reparte una mano nueva: 7 cartas a cada uno y una boca arriba en el pozo. */
export function deal(prev, random = Math.random) {
  const m = clone(prev)
  if (m.winner !== null) throw new Error('La partida terminó')
  if (m.handNo > 0 || m.out[m.dealer]) m.dealer = nextActive(m, m.dealer)
  m.handNo++
  const deck = shuffle(newDeck(), random)
  const hands = Array.from({ length: m.players }, () => [])
  for (let k = 0; k < HAND_SIZE; k++) for (const s of activeSeats(m)) hands[s].push(deck.pop())
  m.hand = {
    hands,
    deck,
    discard: [deck.pop()],
    turn: nextActive(m, m.dealer),
    phase: 'draw', // draw | discard
    drawnFromDiscard: null,
    finished: false,
    result: null,
  }
  push(m, { t: 'deal', dealer: m.dealer, hand: m.handNo })
  return m
}

// Funciona tanto con el estado completo como con la vista de un jugador
const handOf = (m, seat) => (m.hand.hands ? m.hand.hands[seat] : seat === m.me ? m.hand.mine : [])
const discardTop = (m) => (m.hand.discard ? m.hand.discard.at(-1) : m.hand.discardTop) ?? null
const deckCount = (m) => (m.hand.deck ? m.hand.deck.length : m.hand.deckCount)
const discardCount = (m) => (m.hand.discard ? m.hand.discard.length : m.hand.discardCount)

/** ¿Puede cortar tirando esta carta? (con 8 cartas en la mano) */
export function cutInfo(hand, card) {
  const rest = hand.filter((c) => c !== card)
  const best = bestMelds(rest)
  const chinchon = isChinchon(rest)
  return { ok: chinchon || best.points <= CUT_MAX, points: best.points, chinchon }
}

export function legalActions(m, seat) {
  const h = m.hand
  if (!h || h.finished || m.winner !== null || h.turn !== seat || m.out[seat]) return []
  if (h.phase === 'draw') {
    const out = []
    if (deckCount(m) > 0 || discardCount(m) > 1) out.push({ type: 'draw', from: 'deck' })
    if (discardTop(m)) out.push({ type: 'draw', from: 'discard' })
    return out
  }
  const hand = handOf(m, seat)
  const out = []
  for (const card of hand) {
    // La carta que se levantó del pozo no se puede volver a tirar en el mismo turno
    if (card !== h.drawnFromDiscard) out.push({ type: 'discard', card })
    if (cutInfo(hand, card).ok) out.push({ type: 'cut', card })
  }
  return out
}

const sameAction = (a, b) => a.type === b.type && a.from === b.from && a.card === b.card

export function apply(prev, seat, action, random = Math.random) {
  if (!legalActions(prev, seat).some((a) => sameAction(a, action))) throw new Error('Jugada inválida')
  const m = clone(prev)
  const h = m.hand
  const hand = h.hands[seat]

  if (action.type === 'draw') {
    if (action.from === 'deck') {
      if (!h.deck.length) {
        // Se acabó el mazo: se mezcla el pozo menos la de arriba
        const top = h.discard.pop()
        h.deck = shuffle(h.discard, random)
        h.discard = [top]
        push(m, { t: 'reshuffle' })
      }
      hand.push(h.deck.pop())
      h.drawnFromDiscard = null
      push(m, { t: 'draw', seat, from: 'deck' })
    } else {
      const card = h.discard.pop()
      hand.push(card)
      h.drawnFromDiscard = card
      push(m, { t: 'draw', seat, from: 'discard', card })
    }
    h.phase = 'discard'
    return m
  }

  h.hands[seat] = hand.filter((c) => c !== action.card)
  h.drawnFromDiscard = null

  if (action.type === 'discard') {
    h.discard.push(action.card)
    h.phase = 'draw'
    h.turn = nextActive(m, seat)
    push(m, { t: 'discard', seat, card: action.card })
    return m
  }

  // Cortar: la carta va boca abajo y se cuentan los puntos
  push(m, { t: 'cut', seat })
  scoreHand(m, seat, action.card)
  return m
}

function scoreHand(m, cutter, cutCard) {
  const h = m.hand
  const seats = activeSeats(m)
  // Primero quien cortó, después los demás en orden de juego
  const order = [cutter]
  for (let s = nextActive(m, cutter); s !== cutter; s = nextActive(m, s)) order.push(s)

  const cutHand = h.hands[cutter]
  const cutBest = bestMelds(cutHand)
  const chinchon = isChinchon(cutHand)
  let table = cutBest.melds // combinaciones de quien cortó, donde los demás pegan cartas
  const rows = {}
  rows[cutter] = {
    seat: cutter,
    melds: chinchon ? [cutHand.slice()] : cutBest.melds,
    attached: [],
    loose: cutBest.loose,
    points: chinchon ? 0 : cutBest.points === 0 ? -10 : cutBest.points,
    cut: true,
    chinchon,
    menosDiez: !chinchon && cutBest.points === 0,
  }
  for (const s of order.slice(1)) {
    const best = bestMelds(h.hands[s])
    const att = attachCards(table, best.loose)
    table = att.melds
    rows[s] = {
      seat: s,
      melds: best.melds,
      attached: att.attached,
      loose: att.loose,
      points: att.loose.reduce((a, c) => a + cardPoints(c), 0),
    }
  }
  rows[cutter].table = table // cómo quedaron con lo que pegaron los demás

  for (const s of seats) {
    m.scores[s] += rows[s].points
    rows[s].total = m.scores[s]
  }

  const events = []
  if (chinchon) {
    m.winner = cutter
  } else {
    const over = seats.filter((s) => m.scores[s] > m.limit)
    const stillIn = seats.filter((s) => m.scores[s] <= m.limit)
    const top = stillIn.length ? Math.max(...stillIn.map((s) => m.scores[s])) : 0
    for (const s of over) {
      if (!m.reenganche[s] && stillIn.length >= 2) {
        m.reenganche[s] = true
        m.scores[s] = top
        rows[s].total = top
        rows[s].reenganche = top
        events.push({ t: 'reenganche', seat: s, score: top })
      } else {
        m.out[s] = true
        rows[s].out = true
        events.push({ t: 'out', seat: s })
      }
    }
    const left = activeSeats(m)
    if (left.length === 1) m.winner = left[0]
    else if (left.length === 0) {
      // Pasaron todos a la vez: gana el que menos tiene
      m.winner = over.reduce((a, b) => (m.scores[b] < m.scores[a] ? b : a))
      m.out[m.winner] = false
    }
  }
  events.forEach((e) => push(m, e))
  h.finished = true
  h.result = { cutter, cutCard, chinchon, rows: order.map((s) => rows[s]), events }
}

/** Lo que ve un jugador: sus cartas, cuántas tienen los demás, el pozo y el mazo. */
export function viewFor(m, seat) {
  const h = m.hand
  return {
    players: m.players,
    limit: m.limit,
    scores: m.scores,
    out: m.out,
    reenganche: m.reenganche,
    dealer: m.dealer,
    handNo: m.handNo,
    winner: m.winner,
    log: m.log,
    me: seat,
    hand: h && {
      turn: h.turn,
      phase: h.phase,
      finished: h.finished,
      drawnFromDiscard: h.drawnFromDiscard,
      mine: h.hands[seat] ?? [],
      counts: h.hands.map((x) => x.length),
      deckCount: h.deck.length,
      discardTop: h.discard.at(-1) ?? null,
      discardCount: h.discard.length,
      result: h.result,
    },
  }
}
