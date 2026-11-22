import { useEffect, useMemo, useRef, useState } from 'react'
import { bestMelds, cardName, isJoker, parseCard, SUITS } from '../engine/cards.js'
import { CUT_MAX } from '../engine/game.js'
import Card from './Card.jsx'
import TurnTimer from './TurnTimer.jsx'

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)
const theCard = (id) => (isJoker(id) ? 'un comodín' : `el ${lower(cardName(id))}`)

/** Cartas sueltas ordenadas por palo y número; los comodines al final. */
function sortLoose(ids) {
  const key = (id) => (isJoker(id) ? 999 : SUITS.indexOf(parseCard(id).suit) * 20 + parseCard(id).num)
  return ids.slice().sort((a, b) => key(a) - key(b))
}

/** Texto de lo último que hizo otro jugador. */
function lastMove(log, me, names) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]
    if (e.t === 'deal') return null
    if (e.seat === me) return null
    if (e.t === 'timeout') return `A ${names[e.seat]} se le acabó el tiempo`
    if (e.t === 'discard') return `${names[e.seat]} tiró ${theCard(e.card)}`
    if (e.t === 'draw') return e.from === 'discard' ? `${names[e.seat]} levantó ${theCard(e.card)} del pozo` : `${names[e.seat]} robó del mazo`
  }
  return null
}

function ScoreBar({ score, limit }) {
  const ratio = Math.max(0, Math.min(1, score / limit))
  return (
    <span className={`score-bar ${ratio > 0.8 ? 'is-hot' : ''}`}>
      <i style={{ transform: `scaleX(${ratio})` }} />
    </span>
  )
}

export default function Table({ view, me, actions, names, bubbles = {}, onAct, onNextHand, onRestart, onQuit, onBack, onLeave, timer }) {
  const m = view
  const h = m.hand
  const n = m.players
  const hand = h.mine
  const myTurn = actions.length > 0
  const drawPhase = myTurn && h.phase === 'draw'
  const discardPhase = myTurn && h.phase === 'discard'
  const canDeck = actions.some((a) => a.type === 'draw' && a.from === 'deck')
  const canPile = actions.some((a) => a.type === 'draw' && a.from === 'discard')
  const discardable = actions.filter((a) => a.type === 'discard').map((a) => a.card)
  const cuts = actions.filter((a) => a.type === 'cut')

  // Carta elegida para tirar
  const [selected, setSelected] = useState(null)
  const handKey = hand.join(',')
  useEffect(() => setSelected((s) => (hand.includes(s) ? s : null)), [handKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // La carta que recién entró a la mano se marca un momento
  const prevHand = useRef(hand)
  const [fresh, setFresh] = useState(null)
  useEffect(() => {
    const added = hand.filter((c) => !prevHand.current.includes(c))
    prevHand.current = hand
    if (added.length === 1) {
      setFresh(added[0])
      const t = setTimeout(() => setFresh(null), 2200)
      return () => clearTimeout(t)
    }
  }, [handKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // La mano ordenada: primero las combinaciones, después las sueltas
  const arranged = useMemo(() => {
    const best = bestMelds(hand)
    return { groups: [...best.melds, ...(best.loose.length ? [sortLoose(best.loose)] : [])], meldCount: best.melds.length, points: best.points }
  }, [handKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const bestCut = useMemo(() => {
    let best = null
    for (const a of cuts) {
      const pts = bestMelds(hand.filter((c) => c !== a.card)).points
      if (!best || pts < best.pts) best = { card: a.card, pts }
    }
    return best
  }, [handKey, cuts.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const cutCard = cuts.some((a) => a.card === selected) ? selected : bestCut?.card
  const afterSelected = selected && discardPhase ? bestMelds(hand.filter((c) => c !== selected)).points : null

  const [confirmLeave, setConfirmLeave] = useState(false)
  useEffect(() => {
    if (!confirmLeave) return
    const t = setTimeout(() => setConfirmLeave(false), 3500)
    return () => clearTimeout(t)
  }, [confirmLeave])

  const discard = (card) => card && discardable.includes(card) && onAct({ type: 'discard', card })

  const others = [...Array(n - 1).keys()].map((i) => (me + 1 + i) % n)
  const move = lastMove(m.log, me, names)

  let turnText = null
  if (!h.finished && m.winner === null) {
    if (m.out[me]) turnText = `Quedaste afuera. Juega ${names[h.turn]}`
    else if (drawPhase) turnText = 'Te toca: robá del mazo o levantá la del pozo'
    else if (discardPhase)
      turnText = cuts.length ? '¡Podés cortar!' : selected ? null : 'Elegí la carta que vas a tirar'
    else turnText = `Juega ${names[h.turn]}`
  }

  return (
    <main className={`table chinchon players-${n}`}>
      <header className="table-top">
        {onBack && (
          <button className="chip chip-back" onClick={onBack}>
            ‹ Inicio
          </button>
        )}
        <span className="chip">Mano {m.handNo}</span>
        <span className="chip">Se juega a {m.limit}</span>
        {onLeave && m.winner === null && (
          <button
            className={`chip chip-leave ${confirmLeave ? 'is-confirm' : ''}`}
            onClick={() => (confirmLeave ? onLeave() : setConfirmLeave(true))}
          >
            {confirmLeave ? '¿Seguro? Tocá de nuevo' : 'Abandonar'}
          </button>
        )}
      </header>

      <section className={`rivals rivals-${n - 1}`}>
        {others.map((s) => (
          <div
            key={s}
            className={`rival ${h.turn === s && !h.finished ? 'is-turn' : ''} ${m.out[s] ? 'is-out' : ''}`}
            aria-label={`${names[s]}: ${m.scores[s]} puntos`}
          >
            <span className="rival-name">{names[s]}</span>
            <span className="rival-score">
              <b>{m.scores[s]}</b>
              {m.reenganche[s] && <span className="tag-mini" title="Ya se reenganchó">R</span>}
            </span>
            <ScoreBar score={m.scores[s]} limit={m.limit} />
            <span className="rival-cards" aria-hidden="true">
              {m.out[s] ? (
                <span className="muted small">Afuera</span>
              ) : (
                Array.from({ length: h.counts[s] }, (_, i) => <Card key={i} id={null} size="dot" />)
              )}
            </span>
            {bubbles[s] && (
              <span key={bubbles[s].id} className="bubble bubble-top">
                {bubbles[s].text}
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="felt felt-piles">
        <div className="piles">
          <button
            className={`pile pile-deck ${canDeck ? 'is-live' : ''}`}
            onClick={() => canDeck && onAct({ type: 'draw', from: 'deck' })}
            disabled={!canDeck}
            aria-label={`Mazo: ${h.deckCount} cartas${canDeck ? '. Tocá para robar' : ''}`}
          >
            <span className="pile-stack">
              {h.deckCount > 2 && <Card id={null} size="pile" className="pile-under-2" />}
              {h.deckCount > 1 && <Card id={null} size="pile" className="pile-under" />}
              <Card id={null} size="pile" />
            </span>
            <span className="pile-label">Mazo ({h.deckCount})</span>
          </button>
          <button
            className={`pile pile-discard ${canPile || (discardPhase && selected) ? 'is-live' : ''}`}
            onClick={() => (canPile ? onAct({ type: 'draw', from: 'discard' }) : discardPhase && discard(selected))}
            disabled={!canPile && !(discardPhase && discardable.includes(selected))}
            aria-label={h.discardTop ? `Pozo: ${cardName(h.discardTop)}` : 'Pozo vacío'}
          >
            <span className="pile-stack">
              {h.discardTop ? (
                <Card key={h.discardTop + h.discardCount} id={h.discardTop} size="pile" className="pile-top" />
              ) : (
                <span className="card card-pile pile-empty" />
              )}
            </span>
            <span className="pile-label">Pozo</span>
          </button>
        </div>
        {move && !h.finished && <p className="last-move">{move}</p>}
        {turnText && <p className="turn-text">{turnText}</p>}
        {timer && !h.finished && m.winner === null && (
          <TurnTimer deadline={timer.deadline} total={timer.total} mine={myTurn} onExpire={timer.onExpire} />
        )}
      </section>

      <section className="me-bar">
        <span className="me-name">
          {names[me]} <b>{m.scores[me]}</b>
          {m.reenganche[me] && <span className="tag-mini">R</span>}
        </span>
        <ScoreBar score={m.scores[me]} limit={m.limit} />
        <span className="me-loose">
          {arranged.points === 0 ? 'Todo combinado' : `Sueltas: ${arranged.points}`}
        </span>
      </section>

      <section className="my-hand" style={{ '--n': hand.length, '--gaps': `${(arranged.groups.length - 1) * 10}px` }}>
        {arranged.groups.map((g, gi) => (
          <div key={gi} className={`hand-group ${gi < arranged.meldCount ? 'is-meld' : 'is-loose'}`}>
            {g.map((id) => (
              <Card
                key={id}
                id={id}
                size="hand"
                selected={selected === id}
                className={fresh === id ? 'is-fresh' : ''}
                onClick={discardPhase ? () => setSelected((s) => (s === id ? null : id)) : undefined}
                disabled={!discardPhase}
              />
            ))}
          </div>
        ))}
      </section>

      <nav className="actions">
        {discardPhase ? (
          <>
            <p className="hint">
              {selected
                ? `Si tirás ${theCard(selected)} te quedan ${afterSelected} sueltos${
                    selected === h.drawnFromDiscard ? ' (no podés tirar la que levantaste)' : ''
                  }`
                : cuts.length
                  ? `Cortás tirando ${theCard(cutCard)} y te ${bestCut.pts === 0 ? 'queda todo combinado: menos diez' : `quedan ${bestCut.pts}`}`
                  : `Para cortar tenés que quedar con ${CUT_MAX} o menos sueltos`}
            </p>
            <div className="action-row">
              <button className="btn btn-call btn-discard" disabled={!discardable.includes(selected)} onClick={() => discard(selected)}>
                Tirar
              </button>
              {cuts.length > 0 && (
                <button className="btn btn-call btn-cut" onClick={() => onAct({ type: 'cut', card: cutCard })}>
                  Cortar
                </button>
              )}
            </div>
          </>
        ) : null}
      </nav>

      {h.finished && h.result && m.winner === null && <HandResult m={m} me={me} names={names} onNext={onNextHand} />}
      {m.winner !== null && <MatchOver m={m} me={me} names={names} onRestart={onRestart} onQuit={onQuit} />}
    </main>
  )
}

function Mini({ ids, kind }) {
  return (
    <span className={`mini-group mini-${kind}`}>
      {ids.map((id) => (
        <Card key={id} id={id} size="xs" />
      ))}
    </span>
  )
}

function HandResult({ m, me, names, onNext }) {
  const r = m.hand.result
  const cutter = r.rows[0]
  const title = r.chinchon
    ? '¡Chinchón!'
    : cutter.menosDiez
      ? `${cutter.seat === me ? '¡Menos diez!' : `${names[cutter.seat]}: menos diez`}`
      : cutter.seat === me
        ? 'Cortaste'
        : `Cortó ${names[cutter.seat]}`
  return (
    <div className="sheet-backdrop">
      <div className="sheet hand-result">
        <h2>{title}</h2>
        <ul className="result-rows">
          {r.rows.map((row) => (
            <li key={row.seat} className={`result-row ${row.seat === me ? 'is-me' : ''}`}>
              <div className="result-head">
                <b>{names[row.seat]}</b>
                <span className={`result-points ${row.points < 0 ? 'good' : row.points >= 20 ? 'bad' : ''}`}>
                  {row.points > 0 ? `+${row.points}` : row.points}
                </span>
                <span className="result-total">{row.total}</span>
              </div>
              <div className="result-cards">
                {row.melds.map((g, i) => (
                  <Mini key={i} ids={g} kind="meld" />
                ))}
                {row.attached.length > 0 && <Mini ids={row.attached} kind="attached" />}
                {row.loose.length > 0 && <Mini ids={row.loose} kind="loose" />}
              </div>
              {row.attached.length > 0 && <span className="result-note">Pegó {row.attached.length === 1 ? 'una carta' : `${row.attached.length} cartas`} a {names[cutter.seat]}</span>}
              {row.reenganche !== undefined && <span className="result-note">Pasó los {m.limit} y se reenganchó con {row.reenganche}</span>}
              {row.out && <span className="result-note bad">Pasó los {m.limit}: queda afuera</span>}
            </li>
          ))}
        </ul>
        <button className="btn btn-primary" onClick={onNext}>
          Siguiente mano
        </button>
      </div>
    </div>
  )
}

function MatchOver({ m, me, names, onRestart, onQuit }) {
  const won = m.winner === me
  const chinchon = m.hand?.result?.chinchon
  const order = [...Array(m.players).keys()].sort((a, b) => (a === m.winner ? -1 : b === m.winner ? 1 : m.scores[a] - m.scores[b]))
  return (
    <div className="sheet-backdrop">
      <div className={`sheet match-over ${won ? 'is-win' : 'is-loss'}`}>
        <p className="big-word">{won ? '¡Ganaste!' : `Ganó ${names[m.winner]}`}</p>
        {chinchon && <p className="final-score">{won ? 'Con chinchón' : 'Hizo chinchón'}</p>}
        <ol className="standings">
          {order.map((s) => (
            <li key={s} className={s === m.winner ? 'is-winner' : m.out[s] ? 'is-out' : ''}>
              <span>{names[s]}</span>
              <b>{m.scores[s]}</b>
            </li>
          ))}
        </ol>
        <div className={onRestart ? 'sheet-actions' : 'sheet-actions single'}>
          {onRestart && (
            <button className="btn btn-primary" onClick={onRestart}>
              Revancha
            </button>
          )}
          <button className={onRestart ? 'btn btn-ghost' : 'btn btn-primary'} onClick={onQuit}>
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  )
}
