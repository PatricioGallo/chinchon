import { useEffect, useState } from 'react'
import * as api from '@api'
import { displayName } from '../api/shared.js'
import Avatar from './Avatar.jsx'

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Ranking de chinchón: global o entre amigos, del mes o histórico. */
export default function Ranking({ profile, onBack }) {
  const [scope, setScope] = useState('global')
  const [period, setPeriod] = useState('month')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [showRules, setShowRules] = useState(false)

  useEffect(() => {
    let alive = true
    setRows(null)
    setError('')
    api
      .chinchonRanking(scope, period)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [scope, period])

  const top = rows?.filter((r) => r.pos <= 50) ?? []
  const mine = rows?.find((r) => r.user_id === profile.id)
  const mineOutside = mine && !top.includes(mine)
  const pct = (r) => (r.played ? Math.round((100 * r.wins) / r.played) : 0)

  const Row = ({ r }) => (
    <li className={`rank-row ${r.user_id === profile.id ? 'is-me' : ''} ${r.pos <= 3 ? `is-top${r.pos}` : ''}`}>
      <span className="rank-pos">{r.pos}</span>
      <Avatar profile={r} size={38} />
      <span className="person-text">
        <b>{r.user_id === profile.id ? 'Vos' : displayName(r)}</b>
        <span className="muted">
          {r.wins} {Number(r.wins) === 1 ? 'ganada' : 'ganadas'} de {r.played} · {pct(r)}%
        </span>
      </span>
      <span className="rank-points">
        {r.points}
        <small>pts</small>
      </span>
    </li>
  )

  return (
    <main className="ranking">
      <button className="back" onClick={onBack}>
        ‹ Volver
      </button>
      <h2 className="page-title">Ranking</h2>

      <div className="segmented segmented-2" role="tablist" aria-label="Quiénes">
        <button role="tab" aria-selected={scope === 'global'} onClick={() => setScope('global')}>
          Global
        </button>
        <button role="tab" aria-selected={scope === 'friends'} onClick={() => setScope('friends')}>
          Amigos
        </button>
      </div>
      <div className="segmented segmented-2 segmented-soft" role="tablist" aria-label="Período">
        <button role="tab" aria-selected={period === 'month'} onClick={() => setPeriod('month')}>
          Este mes
        </button>
        <button role="tab" aria-selected={period === 'all'} onClick={() => setPeriod('all')}>
          Histórico
        </button>
      </div>

      <section className="panel">
        {period === 'month' && <p className="muted small rank-note">Ranking de {MONTHS[new Date().getMonth()]}: arranca de cero cada mes.</p>}
        {error ? (
          <p className="form-error">{error}</p>
        ) : !rows ? (
          <p className="muted">Cargando…</p>
        ) : top.length === 0 ? (
          <p className="muted">
            {scope === 'friends'
              ? 'Todavía no tenés amigos agregados.'
              : 'Todavía nadie sumó puntos. Ganá una partida online y estrená el ranking.'}
          </p>
        ) : (
          <ul className="people rank-list">
            {top.map((r) => (
              <Row key={r.user_id} r={r} />
            ))}
            {mineOutside && (
              <>
                <li className="rank-gap" aria-hidden="true">
                  ⋯
                </li>
                <Row r={mine} />
              </>
            )}
          </ul>
        )}
        {rows && !mine && scope === 'global' && (
          <p className="muted small">Todavía no estás en el ranking: jugá una partida online contra otra persona.</p>
        )}
      </section>

      <button className="rank-rules-toggle" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
        ¿Cómo se suman puntos? {showRules ? '▴' : '▾'}
      </button>
      {showRules && (
        <section className="panel rank-rules">
          <ul>
            <li>
              <b>Ganar:</b> 10 puntos por cada rival que le ganaste (de a 2: 10, de a 3: 20…).
            </li>
            <li>
              <b>Ganar con chinchón:</b> +10.
            </li>
            <li>
              <b>Ganar sin reengancharte:</b> +5.
            </li>
            <li>
              <b>Terminar la partida aunque pierdas:</b> 1 punto. Abandonar: 0.
            </li>
          </ul>
          <p className="muted small">
            Cuentan solo las partidas online contra personas (no contra la compu). Contra un mismo rival suman como mucho 3
            victorias por día.
          </p>
        </section>
      )}
    </main>
  )
}
