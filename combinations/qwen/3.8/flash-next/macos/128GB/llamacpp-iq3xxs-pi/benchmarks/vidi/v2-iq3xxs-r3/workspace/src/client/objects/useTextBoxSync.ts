import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';

import { LOCAL_ORIGIN, objectOf } from '../../shared/board-model';
import { isTextSize, isTextWidthMode, setTextBox, setTextWidthFixed, textEntryOf } from '../../shared/objects/text';
import { layoutText } from './textLayout';
import type { Measurer } from './textLayout';

/** What the box of one text object does on this client. */
export interface TextBoxSync {
  /**
   * Re-measure and store this text object's box because *this* client changed
   * it — typed into it, picked a size, or dragged its width. Called by the
   * editor's input, the size toolbar and the handle gesture; never by anything
   * that arrived from somebody else.
   */
  remeasureAfterLocalChange(): void;
}

/**
 * The one writer of a text object's `width`/`height` (`text.height`,
 * `text.auto_width`, `text.fixed_width`).
 *
 * A board can hold five people's screens, and every one of them can lay the same
 * text out slightly differently — different fonts, different zoom, different
 * moment. If all of them wrote the measured box, the document would churn with
 * dimensions nobody chose. So only the client that *made* a change writes the
 * box that follows from it, which is what the transaction origin tells us:
 *
 * - a change carrying `LOCAL_ORIGIN` is this client's, and the box is written
 *   again if, and only if, the measurement differs from what is stored;
 * - a change from anybody else arrives with no origin this client owns, and
 *   nothing is written. Their box is the one they measured, and this screen
 *   renders that.
 *
 * That is also what keeps an undo step whole: typing and the box write that
 * follows it are in the same capture window (story 8), so Ctrl+Z takes back a
 * character and the height it had caused as one thing.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  /** The width this client last measured or adopted: the difference from it says "a handle was dragged". */
  const measuredWidth = useRef<number | null>(null);
  /** Guards the write the observer triggers, so a write cannot cause a write. */
  const syncing = useRef(false);

  const sync = useCallback((): void => {
    const entry = textEntryOf(doc, id);
    if (!entry) return; // gone: deleted here or elsewhere, and nothing to measure
    const size = entry.get('size');
    const mode = entry.get('widthMode');
    const ytext = entry.get('text');
    const storedWidth = entry.get('width');
    const storedHeight = entry.get('height');
    if (!isTextSize(size) || !isTextWidthMode(mode) || !(ytext instanceof Y.Text)) return;
    const width = typeof storedWidth === 'number' ? storedWidth : null;

    syncing.current = true;
    try {
      const laid = layoutText(ytext.toString(), size, mode, width, measure);

      // A width that is neither stored-by-us nor what the content asks for was
      // set by a handle: from now on this text keeps that width (`text.size`'s
      // counterpart — the drag is what decides, and the height follows it).
      const dragged =
        mode === 'auto' &&
        width !== null &&
        measuredWidth.current !== null &&
        Math.abs(width - measuredWidth.current) > WIDTH_TOLERANCE &&
        Math.abs(width - laid.width) > WIDTH_TOLERANCE;
      if (dragged) {
        measuredWidth.current = width;
        const fixed = layoutText(ytext.toString(), size, 'fixed', width, measure);
        setTextWidthFixed(doc, id, width as number, fixed.height);
        return;
      }

      measuredWidth.current = laid.width;
      if (laid.width !== storedWidth || laid.height !== storedHeight) {
        setTextBox(doc, id, { width: laid.width, height: laid.height });
      }
    } finally {
      syncing.current = false;
    }
  }, [doc, id, measure]);

  useEffect(() => {
    const entry = objectOf(doc, id);
    if (!entry) return;
    // Adopt the box that is already there: this client did not measure it, and
    // it is not this client's business to disagree with it — yet.
    const stored = entry.get('width');
    if (measuredWidth.current === null && typeof stored === 'number') measuredWidth.current = stored;

    // `observeDeep`, because the characters are not a field of the entry: they
    // are a `Y.Text` inside it, and typing does not touch the map at all. The
    // transaction's origin is the whole rule — only this client's own writes
    // reach here (`LOCAL_ORIGIN` is what every local write in this product
    // carries, the same test story 8's undo filter makes).
    const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction): void => {
      if (events.length === 0 || syncing.current) return;
      if (transaction.origin !== LOCAL_ORIGIN) return;
      sync();
    };
    entry.observeDeep(observer);
    return () => entry.unobserveDeep(observer);
  }, [doc, id, sync]);

  return {
    remeasureAfterLocalChange: () => {
      sync();
    },
  };
}

/** A difference below this is the same width: measuring, not dragging. */
const WIDTH_TOLERANCE = 0.5;
