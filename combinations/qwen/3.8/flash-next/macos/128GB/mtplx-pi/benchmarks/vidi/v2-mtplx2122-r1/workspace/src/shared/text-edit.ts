import * as Y from 'yjs'

/** Clamp to max chars; returns truncated copy if over limit. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next
  return next.slice(0, max)
}

/**
 * Applies a minimal diff from the current content of ytext to next.
 * Uses common prefix/suffix so concurrent typing (story 3) is never
 * destroyed by overwriting the whole text.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString()
  if (current === next) return

  const doc = ytext.doc
  if (!doc) return

  doc.transact(() => {
    // Find common prefix length
    let prefix = 0
    const curLen = current.length
    const nextLen = next.length
    const minLen = Math.min(curLen, nextLen)
    while (prefix < minLen && current[prefix] === next[prefix]) prefix++

    // Find common suffix length (must not overlap prefix)
    let suffix = 0
    while (
      suffix < minLen - prefix &&
      current[curLen - 1 - suffix] === next[nextLen - 1 - suffix]
    ) {
      suffix++
    }

    const deleteLen = curLen - prefix - suffix
    const insertStr = next.slice(prefix, nextLen - suffix)

    if (deleteLen > 0) ytext.delete(prefix, deleteLen)
    if (insertStr.length > 0) ytext.insert(prefix, insertStr)
  }, origin)
}
