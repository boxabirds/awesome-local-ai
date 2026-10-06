/**
 * Keeping a text object's box around its text (story 9).
 *
 * The box is stored on the object so that rendering, selection, marquee and sharing all read the
 * same numbers. That raises the question of who writes them: if every client measured the text it
 * saw, five clients would race to write the same dimensions and each write would travel.
 *
 * The rule this hook enforces (design.text.layout): **only the client that made the change
 * measures**, and it measures inside the same interaction - typing, a size change, a width drag.
 * Updates arriving from anyone else never cause a write here.
 *
 * `growToFit` is the second half of that rule, and the reason it can exist without a race: the
 * screen that *drew* the text can tell whether the box it was given holds the words, and it grows
 * a box that does not, never shrinks one and never touches a width somebody set. Measurement picks
 * the size of a box; a screen that is showing the answer corrects it.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN, transactionOrigin } from '../../shared/y-origin';
import {
  getTextContent,
  getTextRecord,
  growTextBox,
  readTextObject,
  setTextBox,
} from '../../shared/objects/text';
import { createCanvasMeasurer, layoutText, type Measurer } from './textLayout';

export interface TextBoxSync {
  /**
   * Recompute the box from the text as it is now, and store it if it changed.
   *
   * Called after a local change the hook cannot observe by itself - the editor's input, a size
   * button, the end of a width drag. Changes it can observe are measured on the spot, so callers
   * never need to worry about missing one.
   */
  remeasureAfterLocalChange(): void;

  /**
   * Grows the stored box to hold what this screen actually drew, and writes nothing when it fits.
   *
   * `needed` is in world units. The width is only ever grown while the text still has auto width:
   * a width somebody dragged is theirs, and the words wrap inside it.
   */
  growToFit(needed: { width: number; height: number }): void;
}

/**
 * The measurer of the app: one canvas, shared by every text object on the board.
 *
 * Made on first use rather than at import, so a page that never shows a text object never makes
 * one - and so a test run without a canvas implementation falls back to the estimate once, the
 * same way a browser without `measureText` would.
 */
let shared: Measurer | null = null;
function sharedMeasurer(): Measurer {
  if (!shared) shared = createCanvasMeasurer();
  return shared;
}

/**
 * Watches one text object and keeps its box fitted to its content, for local changes only.
 *
 * @param measure injectable so the maths can be tested with a fake measurer; the app leaves it out
 *   and gets the shared canvas measurer.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer = sharedMeasurer(),
): TextBoxSync {
  // The measurer is read through a ref so a new function identity never re-subscribes the observers.
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasure = useCallback(() => {
    const record = getTextRecord(doc, id);
    if (!record) return;
    const object = readTextObject(id, record);
    if (!object) return;
    const box = layoutText(
      object.text,
      object.size,
      object.widthMode,
      object.widthMode === 'fixed' ? object.width : null,
      measureRef.current,
    );
    // A box that already matches writes nothing, so a redundant call is a no-op on the wire.
    setTextBox(doc, id, { width: box.width, height: box.height });
  }, [doc, id]);

  useEffect(() => {
    const record = getTextRecord(doc, id);
    const ytext = getTextContent(doc, id);
    if (!record || !ytext) return;

    // The box write itself fires these observers again; measuring twice would only ever be a
    // no-op, but one measurement per change is the contract, so the re-entry is closed off.
    let syncing = false;
    const sync = (): void => {
      if (syncing) return;
      syncing = true;
      try {
        remeasure();
      } finally {
        syncing = false;
      }
    };

    const onText = (event: Y.YTextEvent, transaction: unknown): void => {
      if (transactionOrigin(event, transaction) !== LOCAL_ORIGIN) return;
      sync();
    };
    const onRecord = (event: Y.YMapEvent<unknown>, transaction: unknown): void => {
      if (transactionOrigin(event, transaction) !== LOCAL_ORIGIN) return;
      const keys = event.keys;
      if (!keys.has('size') && !keys.has('widthMode') && !keys.has('width')) return;
      sync();
    };

    ytext.observe(onText);
    record.observe(onRecord);
    return () => {
      ytext.unobserve(onText);
      record.unobserve(onRecord);
    };
  }, [doc, id, remeasure]);

  const grow = useCallback(
    (needed: { width: number; height: number }) => {
      const record = getTextRecord(doc, id);
      if (!record) return;
      growTextBox(doc, id, needed, record.get('widthMode') !== 'fixed');
    },
    [doc, id],
  );

  return useMemo(
    () => ({ remeasureAfterLocalChange: remeasure, growToFit: grow }),
    [remeasure, grow],
  );
}
