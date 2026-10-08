// Caret mapping through a Y.Text delta (story 9, text.concurrent). When a
// remote (or undo/redo) change arrives while a text is being edited, the live
// textarea is re-synced from Y.Text and the caret must follow the change. This
// maps a caret position in the old text to the equivalent position in the new
// text, given the delta that transformed one into the other.
//
// Convention: an insert that lands exactly at the caret pushes the caret to the
// right (the caret ends up after the inserted characters); a delete that
// contains the caret collapses it to the deletion point.

export type TextDeltaOp = {
  retain?: number;
  insert?: string;
  delete?: number;
};

/**
 * Map `caret` (a character offset in the old text, 0..oldLength) through
 * `delta` to the corresponding offset in the new text.
 */
export function mapCaretThroughDelta(delta: readonly TextDeltaOp[], caret: number): number {
  let oldConsumed = 0;
  let newAccum = 0;
  for (const op of delta) {
    if (op.retain !== undefined) {
      const blockEnd = oldConsumed + op.retain;
      const before = Math.min(blockEnd, caret);
      if (before > oldConsumed) newAccum += before - oldConsumed;
      oldConsumed = blockEnd;
    }
    if (op.insert !== undefined) {
      // An insert at or before the caret position counts toward the caret
      // (insert-at-caret convention: caret lands after the inserted text).
      if (oldConsumed <= caret) newAccum += op.insert.length;
    }
    if (op.delete !== undefined) {
      // Deleted characters produce no new characters.
      oldConsumed += op.delete;
    }
  }
  return newAccum;
}
