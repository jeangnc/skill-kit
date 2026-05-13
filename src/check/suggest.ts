const SUGGESTION_DISTANCE_FLOOR = 2;
const SUGGESTION_DISTANCE_DIVISOR = 3;

export function closestMatch(needle: string, haystack: readonly string[]): string | null {
  let best: { value: string; distance: number } | null = null;
  const threshold = Math.max(
    SUGGESTION_DISTANCE_FLOOR,
    Math.floor(needle.length / SUGGESTION_DISTANCE_DIVISOR),
  );
  for (const candidate of haystack) {
    const distance = levenshtein(needle, candidate);
    if (distance > threshold) continue;
    if (!best || distance < best.distance) best = { value: candidate, distance };
  }
  return best?.value ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (curr[j - 1] ?? 0) + 1;
      const insertion = (prev[j] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}
