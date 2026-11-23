# Chinchón

Chinchón argentino para el celular: contra la compu (sin conexión) u online con amigos.
Comparte cuentas y amigos con el Sudoku y el Truco (misma base de Supabase).

- Mazo de 50 cartas (48 + 2 comodines), de 2 a 6 jugadores, a 100 puntos.
- No se puede cortar hasta que todos jugaron al menos un turno en la mano.
- Se corta con 5 o menos sueltos; menos diez con todo combinado; chinchón gana la partida.
- Al cortar, los demás pegan cartas a las combinaciones de quien cortó.
- Reenganche una vez por jugador, con el puntaje más alto de los que siguen.
- Ranking (online contra personas): ganar = 10 por rival vencido, +10 con chinchón, +5 sin reengancharse;
  terminar perdiendo = 1; abandonar = 0. Máximo 3 victorias por día contra el mismo rival. Global/amigos, mes/histórico.

## Desarrollo

```
npm install
npm run dev:mock   # sin Supabase, con servidor simulado
npm test
```

La función del servidor está en `supabase/functions/chinchon` (usa `src/server` y `src/engine`).
Las tablas, en `supabase/schema.sql`.

Naipes: dibujos de Basquetteur (CC BY-SA 3.0), ver `public/naipes/LICENCIA.txt`.
