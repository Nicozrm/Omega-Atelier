/**
 * fuzzy.ts — subsequence fuzzy matching with relevance scoring.
 *
 * The brain behind the ⌘K palette's ranking. A query matches a target when its
 * characters appear in order (not necessarily adjacent), and the match is
 * *scored* so results can be ranked the way Raycast/Linear do: a hit at the
 * start of a word beats one buried mid-token, consecutive runs beat scattered
 * letters, and shorter targets edge out longer ones on a tie. Pure and
 * renderer-free — the UI only consumes `{ score, indices }`.
 */

export interface FuzzyMatch {
  /** Higher = more relevant. */
  score: number
  /** Indices in `target` that matched — for highlighting. */
  indices: number[]
}

const SEP = /[\s\-_/.,:()]/

/** Score a single whitespace-free needle against a target. */
function scoreToken(needle: string, target: string): FuzzyMatch | null {
  if (!needle) return { score: 0, indices: [] }
  const tl = target.toLowerCase()
  const indices: number[] = []
  let qi = 0
  let score = 0
  let prev = -2
  for (let i = 0; i < tl.length && qi < needle.length; i++) {
    if (tl[i] !== needle[qi]) continue
    let s = 1
    if (i === 0) s += 9 // very start of the string
    else if (SEP.test(target[i - 1])) s += 7 // start of a word
    else if (target[i - 1] === target[i - 1].toLowerCase() && target[i] !== target[i].toLowerCase())
      s += 5 // camelCase hump
    if (i === prev + 1) s += 6 // consecutive run
    score += s
    indices.push(i)
    prev = i
    qi++
  }
  if (qi < needle.length) return null // not a subsequence
  // Prefer tighter targets: penalise the unmatched tail lightly.
  score -= (target.length - indices.length) * 0.1
  return { score, indices }
}

/**
 * Fuzzy-match `query` against `target`. A multi-word query is split on
 * whitespace and every token must match (AND); the score sums and the
 * highlight indices union. Case-insensitive. Returns null when unmatched.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }
  const tokens = q.split(/\s+/)
  let total = 0
  const set = new Set<number>()
  for (const tok of tokens) {
    const m = scoreToken(tok, target)
    if (!m) return null
    total += m.score
    m.indices.forEach((i) => set.add(i))
  }
  return { score: total, indices: [...set].sort((a, b) => a - b) }
}

/**
 * Split `text` into alternating unmatched / matched runs for highlighting,
 * given sorted match indices. Empty leading/trailing runs are omitted.
 */
export function highlightRuns(text: string, indices: number[]): Array<{ text: string; match: boolean }> {
  if (indices.length === 0) return [{ text, match: false }]
  const hit = new Set(indices)
  const runs: Array<{ text: string; match: boolean }> = []
  let buf = ''
  let bufMatch = hit.has(0)
  for (let i = 0; i < text.length; i++) {
    const m = hit.has(i)
    if (m === bufMatch) {
      buf += text[i]
    } else {
      if (buf) runs.push({ text: buf, match: bufMatch })
      buf = text[i]
      bufMatch = m
    }
  }
  if (buf) runs.push({ text: buf, match: bufMatch })
  return runs
}
