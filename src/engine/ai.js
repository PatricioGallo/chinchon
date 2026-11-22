// La compu: levanta del pozo si le sirve, tira lo que menos le sirve y corta en cuanto puede.
import { bestMelds, cardPoints, isJoker, parseCard } from './cards.js'
import { legalActions } from './game.js'

/** Qué tan buena es una mano (menos es mejor): puntos sueltos, con premio a las cartas que "casi" combinan. */
export function handScore(hand) {
  const { loose, points } = bestMelds(hand)
  let potential = 0
  for (const a of loose) {
    if (isJoker(a)) continue
    const ca = parseCard(a)
    const near = loose.some((b) => {
      if (b === a || isJoker(b)) return false
      const cb = parseCard(b)
      return cb.num === ca.num || (cb.suit === ca.suit && Math.abs(cb.num - ca.num) <= 2)
    })
    if (near) potential += cardPoints(a) * 0.45 + 2
  }
  // Un comodín suelto todavía sirve: no cuenta como 25 puntos perdidos
  const jokerLoose = loose.filter(isJoker).length
  return points - potential - jokerLoose * 22
}

/** La mejor carta para tirar de una mano de 8 (y cómo queda). */
function bestDiscard(hand, forbidden) {
  let best = null
  for (const card of hand) {
    if (card === forbidden) continue
    const rest = hand.filter((c) => c !== card)
    const score = handScore(rest) - (isJoker(card) ? -40 : 0) - cardPoints(card) * 0.05
    if (!best || score < best.score) best = { card, score }
  }
  return best
}

export function chooseAction(view, seat) {
  const actions = legalActions(view, seat)
  if (!actions.length) return null
  const h = view.hand
  const hand = h.mine

  if (h.phase === 'draw') {
    const top = h.discardTop
    const canDeck = actions.some((a) => a.from === 'deck')
    if (top && actions.some((a) => a.from === 'discard')) {
      if (isJoker(top) || !canDeck) return { type: 'draw', from: 'discard' }
      const now = handScore(hand)
      const withTop = bestDiscard([...hand, top], top)
      // Le conviene si mejora claramente la mano
      if (withTop && withTop.score <= now - 3) return { type: 'draw', from: 'discard' }
    }
    return { type: 'draw', from: canDeck ? 'deck' : 'discard' }
  }

  // Cortar si se puede (eligiendo la carta que deja menos puntos)
  const cuts = actions.filter((a) => a.type === 'cut')
  if (cuts.length) {
    let best = null
    for (const a of cuts) {
      const pts = bestMelds(hand.filter((c) => c !== a.card)).points
      if (!best || pts < best.pts || (pts === best.pts && cardPoints(a.card) > cardPoints(best.a.card))) best = { a, pts }
    }
    return best.a
  }
  const d = bestDiscard(hand, h.drawnFromDiscard)
  return { type: 'discard', card: d.card }
}
