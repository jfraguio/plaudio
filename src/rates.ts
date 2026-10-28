/** Velocidades de reproducción disponibles (fuente única para UI, teclado y persistencia). */
export const PLAYBACK_RATES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

export const DEFAULT_RATE = 1;

/** Devuelve la velocidad disponible más cercana; valores inválidos dan `DEFAULT_RATE`. */
export function nearestRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_RATE;
  return PLAYBACK_RATES.reduce((closest, option) =>
    Math.abs(option - rate) < Math.abs(closest - rate) ? option : closest,
  );
}

/** Avanza `direction` posiciones en la lista de velocidades, sin salirse de ella. */
export function stepRate(current: number, direction: 1 | -1): number {
  const index = PLAYBACK_RATES.indexOf(nearestRate(current));
  const next = Math.min(Math.max(index + direction, 0), PLAYBACK_RATES.length - 1);
  return PLAYBACK_RATES[next]!;
}
