import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoom, joinRoom, actRoom, timeoutRoom, viewForUser, startWithCpu, TURN_MS } from '../src/server/rooms.js'
import { legalActions } from '../src/engine/game.js'
import { chooseAction } from '../src/engine/ai.js'

test('sala de 4 con dos personas y dos compus, hasta el final', () => {
  let room = createRoom({ id: 'r', code: 'ABCDE', hostId: 'a', players: 4, seats: [null, { userId: 'b' }, 'cpu', 'cpu'], now: 0 })
  assert.equal(room.status, 'waiting')
  room = joinRoom(room, 'b', 0)
  assert.equal(room.status, 'playing')
  let t = 0
  for (let i = 0; i < 5000 && room.status === 'playing'; i++) {
    const m = room.match
    if (m.hand.finished) {
      room = actRoom(room, i % 2 ? 'a' : 'b', { type: 'next' }, t)
      continue
    }
    const uid = ['a', 'b'].find((u, k) => legalActions(m, k).length)
    assert.ok(uid, 'le toca a una persona')
    const seat = uid === 'a' ? 0 : 1
    const v = viewForUser(room, uid)
    room = actRoom(room, uid, chooseAction(v.match, seat), (t += 1000))
  }
  assert.equal(room.status, 'finished')
})

test('si se acaba el tiempo, juega la compu; si alguien se va, lo reemplaza', () => {
  let room = createRoom({ id: 'r', code: 'ABCDE', hostId: 'a', players: 3, seats: [null, { userId: 'b' }, null], now: 0 })
  room = startWithCpu(room, 'a', 0)
  assert.equal(room.seats[1].type, 'cpu')
  assert.throws(() => timeoutRoom(room, 'a', 1000))
  const before = room.version
  room = timeoutRoom(room, 'a', TURN_MS + 10)
  assert.ok(room.version > before)
  room = actRoom(room, 'a', { type: 'leave' }, TURN_MS + 20)
  assert.equal(room.status, 'cancelled')
})
