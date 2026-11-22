// Naipe de la baraja española (dibujos de Basquetteur, CC BY-SA 3.0; ver public/naipes/LICENCIA.txt).
// El comodín es un dibujo propio en el mismo estilo.
import { cardName, isJoker } from '../engine/cards.js'

const src = (name) => `${import.meta.env.BASE_URL}naipes/${name}.webp`

/** Carta boca arriba (`id`) o boca abajo (`id` = null). */
export default function Card({ id, size = 'md', onClick, disabled, selected, className = '', style }) {
  if (!id) {
    return (
      <span className={`card card-${size} card-back ${className}`} style={style} aria-label="Carta boca abajo">
        <img src={src('dorso')} alt="" draggable="false" />
      </span>
    )
  }
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      className={`card card-${size} ${selected ? 'is-selected' : ''} ${className}`}
      style={style}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      aria-label={cardName(id)}
      aria-pressed={onClick ? !!selected : undefined}
    >
      <img src={src(isJoker(id) ? 'comodin' : id)} alt="" draggable="false" />
    </Tag>
  )
}
