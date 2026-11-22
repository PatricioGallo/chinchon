import { useState } from 'react'
import { displayName } from '../api/shared.js'
import { CPU_NAMES } from '../roomText.js'
import { LIMITS } from '../engine/game.js'

/** Armar una partida con amigos: cuántos juegan y quién va en cada lugar. */
export default function NewOnline({ friends, preset, onCreate, onBack }) {
  const [players, setPlayers] = useState(2)
  const [limit, setLimit] = useState(100)
  const presetValue = preset ? `friend:${preset.id}` : null
  // Lugares 1..5 (el 0 sos vos)
  const [seats, setSeats] = useState({ 1: presetValue ?? 'open', 2: 'open', 3: 'open', 4: 'open', 5: 'open' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const chosen = Object.entries(seats)
    .filter(([s]) => Number(s) < players)
    .map(([, v]) => v)
    .filter((v) => v.startsWith('friend:'))
  const repeated = chosen.length !== new Set(chosen).size

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const list = [null]
      for (let s = 1; s < players; s++) {
        const v = seats[s]
        list.push(v === 'cpu' ? 'cpu' : v === 'open' ? null : { userId: v.slice(7) })
      }
      await onCreate({ players, limit, seats: list })
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <main className="new-online">
      <button className="back" onClick={onBack}>
        ‹ Volver
      </button>
      <h2 className="page-title">Jugar con amigos</h2>

      <p className="field-label">¿Cuántos juegan?</p>
      <div className="segmented segmented-6" role="tablist">
        {[2, 3, 4, 5, 6].map((k) => (
          <button key={k} role="tab" aria-selected={players === k} onClick={() => setPlayers(k)}>
            {k}
          </button>
        ))}
      </div>

      <p className="field-label">¿Hasta cuántos puntos?</p>
      <div className="segmented segmented-4" role="tablist">
        {LIMITS.map((k) => (
          <button key={k} role="tab" aria-selected={limit === k} onClick={() => setLimit(k)}>
            {k}
          </button>
        ))}
      </div>

      <section className="panel">
        {[...Array(players - 1).keys()].map((i) => {
          const seat = i + 1
          return (
            <label key={seat} className="field">
              <span>Jugador {seat + 1}</span>
              <select value={seats[seat]} onChange={(e) => setSeats((x) => ({ ...x, [seat]: e.target.value }))}>
                <option value="open">Cualquiera con el código</option>
                <option value="cpu">La compu ({CPU_NAMES[seat]})</option>
                {friends.map(({ profile: p }) => (
                  <option key={p.id} value={`friend:${p.id}`}>
                    {displayName(p)} (@{p.username})
                  </option>
                ))}
              </select>
            </label>
          )
        })}
        {friends.length === 0 && (
          <p className="muted small">Todavía no tenés amigos. Podés crear la sala y pasarle el código a quien quieras.</p>
        )}
      </section>

      {repeated && <p className="form-error">Elegiste al mismo amigo en dos lugares.</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy || repeated} onClick={create}>
        {busy ? 'Creando…' : 'Crear partida e invitar'}
      </button>
    </main>
  )
}
