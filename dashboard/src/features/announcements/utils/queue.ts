// How many sentences wait their turn at most: some twenty seconds of speech, never a minute.
export const QUEUE_LIMIT = 3

// The sentences waiting once `fresh` ones arrive, in the order to say them. Past the limit, those that
// waited longest go first: they are news no more. Then the last of the fresh ones, the least severe.
export function queued(waiting: readonly string[], fresh: readonly string[], limit = QUEUE_LIMIT): string[] {
  const kept = fresh.slice(0, limit)
  const room = limit - kept.length
  return [...waiting.slice(waiting.length - Math.min(room, waiting.length)), ...kept]
}

// How many sentences stay written for a screen reader to come back to.
export const WRITTEN_LIMIT = 5

// A sentence written in the live region, with a number of its own: the same one said twice is two lines.
export interface Line {
  id: number
  text: string
}

// The live region once `fresh` sentences are written under the others: the latest ones only.
export function written(lines: readonly Line[], fresh: readonly string[], limit = WRITTEN_LIMIT): Line[] {
  const next = (lines.at(-1)?.id ?? 0) + 1
  return [...lines, ...fresh.map((text, index) => ({ id: next + index, text }))].slice(-limit)
}
