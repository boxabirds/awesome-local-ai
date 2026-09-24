/**
 * Story 9 · task 4 — the box-sync hook (design Key decision 1).
 *
 * A text object stores its `width`/`height` so the selection bounds, the
 * marquee and a later export can read a box without every client re-measuring.
 * The rule that keeps five clients from racing to write the same dimensions is:
 * **only the client that made the local change writes the box**, and only when
 * the measured box actually differs from the stored one. Remote updates (and a
 * box that did not change) produce zero writes.
 *
 * This module is deliberately tiny and pure with respect to its inputs so the
 * local-only rule is directly testable: a test hands it two real `Y.Doc`s (one
 * local, one simulated remote peer), a fake measurer, and counts `setTextBox`
 * writes. `remeasureAfterLocalChange()` is called only from local typing, a
 * local size change and a fixed-width handle drag — never from a remote update.
 */
import * as Y from 'yjs';
import { getTextSize, getTextWidthMode, setTextBox, type TextWidthMode } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';

export type { TextSize, TextWidthMode };

/** Measure the width of `text` at `fontPx`, in world units. */
export type BoxMeasurer = (text: string, fontPx: number) => number;

/** The pure layout used to turn text + size + mode + width into a box. */
export type BoxLayout = (
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: BoxMeasurer,
) => { width: number; height: number };

export interface TextBoxSync {
  /**
   * Recompute the box from the object's current text / size / mode and write it
   * only if it differs. Returns true when a write happened. Call this **only**
   * after a local change; a remote update must not call it (that is the whole
   * point — remote clients render the stored box, they never rewrite it).
   */
  remeasureAfterLocalChange(): boolean;
}

/**
 * Build the box-sync for one text object. The layout, measurer and the object
 * id are captured so the returned closure is stable; the object's own fields
 * (text, size, widthMode) are read fresh on each call, so it always measures the
 * current content.
 */
export function createTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: BoxMeasurer,
  layout: BoxLayout,
): TextBoxSync {
  return {
    remeasureAfterLocalChange(): boolean {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const record = objects.get(id);
      if (!record || record.get('type') !== 'text') return false;
      const text = record.get('text');
      if (!(text instanceof Y.Text)) return false;
      const size = getTextSize(doc, id);
      const mode = getTextWidthMode(doc, id);
      const storedWidth = record.get('width') as number;
      const box = layout(
        text.toString(),
        size,
        mode,
        mode === 'fixed' ? storedWidth : null,
        measure,
      );
      return setTextBox(doc, id, { width: box.width, height: box.height });
    },
  };
}