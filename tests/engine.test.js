import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meldKind, bestMelds, isChinchon, attachCards, newDeck, orderMeld } from '../src/engine/cards.js'
import { createMatch, deal, apply, legalActions, viewFor } from '../src/engine/game.js'
import { chooseAction } from '../src/engine/ai.js'

const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

test('mazo de 50 cartas con dos comodines', () => {
  const d = newDeck()
  assert.equal(d.length, 50)
  assert.equal(new Set(d).size, 50)
  assert.ok(d.includes('8o') && d.includes('9e') && d.includes('J1'))
})

test('combinaciones válidas e inválidas', () => {
  assert.equal(meldKind(['3o', '4o', '5o']), 'escalera')
  assert.equal(meldKind(['3o', 'J1', '5o']), 'escalera')
  assert.equal(meldKind(['7o', '8o', '9o', '10o']), 'escalera')
  assert.equal(meldKind(['7e', '7b', '7c']), 'pierna')
  assert.equal(meldKind(['7e', '7b', 'J2']), 'pierna')
  assert.equal(meldKind(['3o', '4o', '5c']), null)
  assert.equal(meldKind(['3o', '4o']), null)
  assert.equal(meldKind(['3o', 'J1', 'J2']), null)
  assert.equal(meldKind(['3o', '6o', 'J1']), null)
  assert.deepEqual(orderMeld(['5o', 'J1', '3o']), ['3o', 'J1', '5o'])
})

test('la mejor forma de bajar deja lo mínimo suelto', () => {
  const r = bestMelds(['3o', '4o', '5o', '5e', '5b', '12c', '1c'])
  // 3-4-5 de oro + suelto: 5e 5b 12c 1c = 23; o pierna de 5 + 3o 4o 12c 1c = 20
  assert.equal(r.points, 20)
  const r2 = bestMelds(['3o', '4o', '5o', '6o', '7e', '7b', '7c'])
  assert.equal(r2.points, 0)
  assert.equal(r2.melds.length, 2)
  const r3 = bestMelds(['1o', '2o', 'J1', '10e', '10b', '11c', '12c'])
  // Conviene usar el comodín con 11 y 12 de copa: quedan 1 + 2 + 10 + 10
  assert.equal(r3.points, 23)
})

test('chinchón: siete seguidas del mismo palo sin comodín', () => {
  assert.ok(isChinchon(['1c', '2c', '3c', '4c', '5c', '6c', '7c']))
  assert.ok(isChinchon(['6e', '7e', '8e', '9e', '10e', '11e', '12e']))
  assert.ok(!isChinchon(['1c', '2c', '3c', 'J1', '5c', '6c', '7c']))
})

test('pegar cartas a las combinaciones de quien cortó', () => {
  const r = attachCards([['3o', '4o', '5o'], ['7e', '7b', '7c']], ['6o', '7o', '12b', '2o'])
  assert.deepEqual(r.attached.sort(), ['2o', '6o', '7o'].sort())
  assert.deepEqual(r.loose, ['12b'])
})

test('cortar con menos diez y puntajes', () => {
  let m = deal(createMatch({ players: 2 }), seeded(3))
  // Armamos una mano a mano
  m.hand.hands[0] = ['3o', '4o', '5o', '6o', '7e', '7b', '7c']
  m.hand.hands[1] = ['1e', '2b', '4c', '6c', '8e', '10b', '12o']
  m.hand.deck.push('9b')
  m.hand.turn = 0
  m.hand.discards = 2 // ya jugaron los dos una ronda
  m = apply(m, 0, { type: 'draw', from: 'deck' })
  assert.ok(legalActions(m, 0).some((a) => a.type === 'cut' && a.card === '9b'))
  m = apply(m, 0, { type: 'cut', card: '9b' })
  assert.ok(m.hand.finished)
  const [cut, other] = m.hand.result.rows
  assert.equal(cut.points, -10)
  assert.ok(cut.menosDiez)
  assert.equal(other.points, 1 + 2 + 4 + 6 + 8 + 10 + 12)
})

test('no se puede cortar con más de 5 sueltos ni tirar la del pozo', () => {
  let m = deal(createMatch({ players: 2 }), seeded(9))
  m.hand.hands[0] = ['3o', '4o', '5o', '6o', '12e', '11b', '10c']
  m.hand.discard.push('9c')
  m.hand.turn = 0
  m = apply(m, 0, { type: 'draw', from: 'discard' })
  const acts = legalActions(m, 0)
  assert.ok(!acts.some((a) => a.type === 'cut'))
  assert.ok(!acts.some((a) => a.type === 'discard' && a.card === '9c'))
})

test('no se puede cortar hasta que todos jugaron una ronda', () => {
  let m = deal(createMatch({ players: 3 }), seeded(5))
  const first = m.hand.turn
  const ganadora = ['3o', '4o', '5o', '6o', '7e', '7b', '7c']
  // Primer turno: aunque tenga todo combinado, no puede cortar
  m.hand.hands[first] = ganadora.slice()
  m.hand.deck.push('1c')
  m = apply(m, first, { type: 'draw', from: 'deck' })
  assert.ok(!legalActions(m, first).some((a) => a.type === 'cut'))
  assert.ok(!legalActions(viewFor(m, first), first).some((a) => a.type === 'cut'))
  assert.throws(() => apply(m, first, { type: 'cut', card: '1c' }))
  m = apply(m, first, { type: 'discard', card: '1c' })
  // Juegan los otros dos (el último en jugar tampoco puede cortar en su primer turno)
  for (let i = 0; i < 2; i++) {
    const s = m.hand.turn
    m = apply(m, s, { type: 'draw', from: 'deck' })
    if (i === 1) {
      m.hand.hands[s] = [...ganadora, '1b']
      assert.ok(!legalActions(m, s).some((a) => a.type === 'cut'))
    }
    m = apply(m, s, { type: 'discard', card: m.hand.hands[s].at(-1) })
  }
  // Ya jugaron todos: ahora sí puede cortar
  m.hand.hands[first] = ganadora.slice()
  m.hand.deck.push('2c')
  m = apply(m, first, { type: 'draw', from: 'deck' })
  assert.ok(legalActions(m, first).some((a) => a.type === 'cut' && a.card === '2c'))
})

test('reenganche una vez y después queda afuera', () => {
  let m = deal(createMatch({ players: 3 }), seeded(4))
  m.scores = [95, 20, 30]
  m.hand.hands[1] = ['3o', '4o', '5o', '6o', '7e', '7b', '7c']
  m.hand.hands[0] = ['12e', '12b', '11c', '10c', '9e', '8b', '1o']
  m.hand.deck.push('1c')
  m.hand.turn = 1
  m.hand.discards = 3
  m = apply(m, 1, { type: 'draw', from: 'deck' })
  m = apply(m, 1, { type: 'cut', card: '1c' })
  assert.equal(m.reenganche[0], true)
  assert.equal(m.scores[0], Math.max(m.scores[1], m.scores[2]))
  assert.equal(m.out[0], false)
})

test('partidas completas entre computadoras de 2 a 6 jugadores', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    for (let seed = 1; seed <= 4; seed++) {
      const random = seeded(seed * 31 + players)
      let m = deal(createMatch({ players }), random)
      let steps = 0
      while (m.winner === null && steps++ < 20000) {
        if (m.hand.finished) {
          m = deal(m, random)
          continue
        }
        const seat = m.hand.turn
        const v = viewFor(m, seat)
        assert.ok(!JSON.stringify(v.hand.counts).includes('o'))
        const a = chooseAction(v, seat)
        m = apply(m, seat, a, random)
      }
      assert.notEqual(m.winner, null, `terminó ${players} jugadores semilla ${seed}`)
      const totalCards = (h) => h.hands.flat().length + h.deck.length + h.discard.length
      if (!m.hand.finished) assert.equal(totalCards(m.hand), 50)
    }
  }
})

test('la vista no muestra las cartas ajenas', () => {
  const m = deal(createMatch({ players: 3 }), seeded(2))
  const v = viewFor(m, 1)
  assert.deepEqual(v.hand.mine, m.hand.hands[1])
  assert.ok(!JSON.stringify(v).includes(JSON.stringify(m.hand.hands[0])))
  assert.equal(v.hand.deckCount, 50 - 21 - 1)
})
