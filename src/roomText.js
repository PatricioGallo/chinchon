// Nombres de la compu y títulos de las partidas.
export const CPU_NAMES = ['Compu', 'Beto', 'Chela', 'Ramón', 'Pocha', 'Tito']
export const roomTitle = (players, limit) =>
  `${players === 2 ? 'Mano a mano' : `Mesa de ${players}`}${limit && limit !== 100 ? ` a ${limit}` : ''}`
