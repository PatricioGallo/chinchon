// Mazo español de 50 cartas: del 1 al 12 de cada palo y dos comodines.
// Ids: número + inicial del palo ('7o', '12e') y 'J1' / 'J2' para los comodines.

export const SUITS = ['espada', 'basto', 'oro', 'copa']
export const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
export const JOKERS = ['J1', 'J2']
/** Lo que suma un comodín si queda suelto. */
export const JOKER_POINTS = 25

export const isJoker = (id) => id[0] === 'J'
export const parseCard = (id) => {
  if (isJoker(id)) return { joker: true }
  const suit = SUITS.find((s) => s[0] === id.at(-1))
  return { num: Number(id.slice(0, -1)), suit }
}

export function newDeck() {
  return [...SUITS.flatMap((suit) => NUMBERS.map((num) => `${num}${suit[0]}`)), ...JOKERS]
}

/** Puntos que suma una carta suelta. */
export const cardPoints = (id) => (isJoker(id) ? JOKER_POINTS : parseCard(id).num)

/** Mezcla con una función aleatoria (inyectable para tests y para el servidor). */
export function shuffle(deck, random = Math.random) {
  const d = deck.slice()
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

export function cardName(id) {
  if (isJoker(id)) return 'Comodín'
  const c = parseCard(id)
  const names = { 10: 'Sota', 11: 'Caballo', 12: 'Rey' }
  return `${names[c.num] ?? c.num} de ${c.suit}`
}

// ---------- Combinaciones ----------

/**
 * ¿Es una combinación válida? Escalera: 3 o más cartas seguidas del mismo palo.
 * Pierna: 3 o 4 cartas del mismo número. Los comodines reemplazan cualquier carta,
 * pero cada combinación necesita al menos dos cartas de verdad.
 */
export function meldKind(ids) {
  if (ids.length < 3) return null
  const real = ids.filter((id) => !isJoker(id)).map(parseCard)
  const jokers = ids.length - real.length
  if (real.length < 2) return null
  // Pierna
  if (real.every((c) => c.num === real[0].num) && ids.length <= 4) return 'pierna'
  // Escalera
  if (!real.every((c) => c.suit === real[0].suit)) return null
  const nums = real.map((c) => c.num).sort((a, b) => a - b)
  for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]) return null
  const gaps = nums.at(-1) - nums[0] + 1 - nums.length
  if (gaps > jokers) return null
  if (ids.length > 12) return null
  return 'escalera'
}

/** Ordena una combinación para mostrarla (escaleras de menor a mayor, con el comodín en su hueco). */
export function orderMeld(ids) {
  const real = ids.filter((id) => !isJoker(id))
  const jokers = ids.filter(isJoker)
  if (meldKind(ids) !== 'escalera') return [...real.sort(), ...jokers]
  const byNum = new Map(real.map((id) => [parseCard(id).num, id]))
  const nums = [...byNum.keys()].sort((a, b) => a - b)
  const out = []
  let j = 0
  for (let n = nums[0]; n <= nums.at(-1); n++) out.push(byNum.get(n) ?? jokers[j++])
  // Comodines que sobran: al final si entran, si no al principio
  while (j < jokers.length) {
    if (nums.at(-1) + (out.length - (nums.at(-1) - nums[0] + 1)) < 12) out.push(jokers[j++])
    else out.unshift(jokers[j++])
  }
  return out
}

const sum = (ids) => ids.reduce((s, id) => s + cardPoints(id), 0)

/**
 * La mejor forma de bajar una mano: las combinaciones que dejan menos puntos sueltos.
 * Devuelve { melds, loose, points }. Prueba todas las combinaciones posibles (son pocas cartas).
 */
export function bestMelds(hand) {
  const n = hand.length
  const full = (1 << n) - 1
  const valid = []
  for (let mask = 1; mask <= full; mask++) {
    let bits = 0
    for (let m = mask; m; m &= m - 1) bits++
    if (bits < 3) continue
    const ids = hand.filter((_, i) => mask & (1 << i))
    if (meldKind(ids)) valid.push(mask)
  }
  const memo = new Map()
  const solve = (used) => {
    if (memo.has(used)) return memo.get(used)
    // Lo que queda suelto si no armamos nada más
    let best = { points: sum(hand.filter((_, i) => !(used & (1 << i)))), melds: [] }
    // Para no repetir, cada combinación tiene que incluir la primera carta libre
    const first = [...Array(n).keys()].find((i) => !(used & (1 << i)))
    if (first !== undefined) {
      for (const mask of valid) {
        if (mask & used || !(mask & (1 << first))) continue
        const r = solve(used | mask)
        if (r.points < best.points) best = { points: r.points, melds: [mask, ...r.melds] }
      }
      // O dejar esa carta suelta
      const r = solve(used | (1 << first))
      const pts = r.points + cardPoints(hand[first])
      if (pts < best.points) best = { points: pts, melds: r.melds }
    }
    memo.set(used, best)
    return best
  }
  const r = solve(0)
  const melds = r.melds.map((mask) => orderMeld(hand.filter((_, i) => mask & (1 << i))))
  const inMeld = new Set(melds.flat())
  const loose = hand.filter((id) => !inMeld.has(id))
  return { melds, loose, points: sum(loose) }
}

/** ¿Es chinchón? Siete cartas seguidas del mismo palo, sin comodín. */
export function isChinchon(hand) {
  return hand.length === 7 && !hand.some(isJoker) && meldKind(hand) === 'escalera'
}

/**
 * Pega cartas sueltas en las combinaciones de quien cortó.
 * Devuelve { melds (actualizadas), attached: [ids], loose }.
 */
export function attachCards(melds, loose) {
  const out = melds.map((m) => m.slice())
  let rest = loose.slice().sort((a, b) => cardPoints(b) - cardPoints(a))
  const attached = []
  let changed = true
  while (changed) {
    changed = false
    for (const id of rest) {
      const i = out.findIndex((m) => meldKind([...m, id]))
      if (i !== -1) {
        out[i] = orderMeld([...out[i], id])
        attached.push(id)
        rest = rest.filter((x) => x !== id)
        changed = true
        break
      }
    }
  }
  return { melds: out, attached, loose: rest }
}
