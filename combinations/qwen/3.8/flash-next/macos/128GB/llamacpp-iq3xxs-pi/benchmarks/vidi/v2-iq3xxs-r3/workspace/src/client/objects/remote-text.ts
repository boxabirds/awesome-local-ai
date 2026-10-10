/**
 * Keeping a live textarea in step with a `Y.Text` that other people are typing
 * in (story 3: live.merge).
 *
 * The editor commits every keystroke, so between keystrokes the string in the
 * textarea and the string in the doc are the same string. When somebody else's
 * characters arrive, the textarea has to change with the doc — otherwise the
 * next keystroke is diffed against a stale copy and `applyTextDiff` wipes what
 * just arrived. What has to survive is the caret: a person mid-word does not
 * want their next character sent to the end of the line.
 *
 * `mapIndex` answers the one question the caret needs — where does this position
 * in the old text sit in the new one — for the delta a `Y.Text` event carries.
 */

/** One operation of a `Y.Text` change: retain some, insert some, delete some. */
export interface TextDeltaOp {
  readonly retain?: number;
  readonly insert?: unknown;
  readonly delete?: number;
}

/** A caret position and (optionally) a selection, in one text. */
export interface Caret {
  readonly start: number;
  readonly end: number;
}

/**
 * Where `index` in the text before the change lands after it.
 *
 * - text inserted at or before the index pushes it right;
 * - text deleted before it pulls it left;
 * - an index inside a deleted range collapses to where that range started,
 *   which is also what a browser does with a selection the server removed;
 * - nothing else moves it.
 *
 * A non-string `insert` (an embedded object; sticky note text has none) is
 * treated as taking no room.
 */
export function mapIndex(index: number, delta: readonly TextDeltaOp[]): number {
  let oldAt = 0;
  let newAt = 0;
  for (const op of delta) {
    if (typeof op.retain === 'number') {
      if (index <= oldAt + op.retain) return newAt + (index - oldAt);
      oldAt += op.retain;
      newAt += op.retain;
    } else if (typeof op.insert === 'string') {
      if (index < oldAt) return newAt;
      newAt += op.insert.length;
    } else if (typeof op.delete === 'number') {
      if (index <= oldAt) return newAt;
      if (index < oldAt + op.delete) return newAt;
      oldAt += op.delete;
    }
  }
  return newAt + Math.max(0, index - oldAt);
}

/**
 * Where a whole caret/selection ends up. The two ends are mapped independently;
 * if the remote change removed text between them, the selection narrows rather
 * than pointing into text that is gone.
 */
export function mapCaret(caret: Caret, delta: readonly TextDeltaOp[]): Caret {
  const start = mapIndex(caret.start, delta);
  const end = Math.max(start, mapIndex(caret.end, delta));
  return { start, end };
}
