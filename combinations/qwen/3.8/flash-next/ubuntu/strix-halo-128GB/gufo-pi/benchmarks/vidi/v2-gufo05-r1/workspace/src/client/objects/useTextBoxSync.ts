/**
 * Keeping a text object's stored box in step with its content.
 *
 * `text.box` says width and height follow the content, and the box is *stored* in
 * the document rather than measured by whoever looks at it — because the selection,
 * the marquee, the hit test and an export all need a rectangle and cannot wait for
 * a measurement (key decision 1). That leaves one question: who writes it?
 *
 * **Only the client that made the change.** Every local mutation is opened with
 * `LOCAL_ORIGIN`, so `afterTransaction` says exactly which changes came from this
 * person's keyboard and mouse. A remote edit arrives with some other origin and is
 * rendered as stored, unwritten: if all five people on a board re-measured and wrote
 * the same text, that is five write transactions, five sets of sync traffic and five
 * undo steps for one keystroke.
 *
 * The listener is the safety net, not the main path. Every place that changes text,
 * size or width calls `remeasureAfterLocalChange` explicitly, so the write happens
 * next to the change a reader is looking for; the listener catches the case a caller
 * forgot — a text object whose content changed and whose box did not would clip its
 * own text on every screen (`text.box`).
 */
import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { readTextSnapshot, setTextBox } from '../../shared/objects/text';
import { layoutText, sharedMeasurer, type Measurer } from './textLayout';

export interface TextBoxSync {
  /** Measure the object again and store the box, after a change made on this client. */
  remeasureAfterLocalChange(): void;
}

/**
 * What a re-measure depends on: the characters, the font size, and the width the
 * text is being wrapped at. Position, stacking order and colour are not in it —
 * moving a text object must not cause a re-measure write.
 *
 * `width` counts only in fixed mode, where the stored width *is* the wrap width and
 * so changes the number of lines. In auto mode the width is derived, and writing it
 * back would be a loop.
 */
function measureKey(doc: Y.Doc, id: string): string | null {
  const obj = readTextSnapshot(doc, id);
  if (!obj) return null;
  const wrap = obj.widthMode === 'fixed' ? String(obj.width) : '';
  return `${obj.widthMode}\u0000${wrap}\u0000${obj.size}\u0000${obj.text}`;
}

/** Measure and store the box. Writes nothing when the box is already right. */
function writeBox(doc: Y.Doc, id: string, measure: Measurer): void {
  const obj = readTextSnapshot(doc, id);
  if (!obj) return; // deleted while we were measuring: nothing to resize
  const layout = layoutText(
    obj.text,
    obj.size,
    obj.widthMode,
    obj.widthMode === 'fixed' ? obj.width : null,
    measure,
  );
  setTextBox(doc, id, { width: layout.width, height: layout.height });
}

/**
 * Measure an object and store its box, right now, after a change made here.
 *
 * For the callers that are not the object itself — a toolbar changing the font size, or
 * turning a fixed width on — so that the change and the box it implies happen together
 * rather than on some later render. The hook below is for the object; this is for the
 * places outside it that write to it.
 */
export function remeasureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer = sharedMeasurer(),
): void {
  writeBox(doc, id, measure);
}

/**
 * Track one text object's box.
 *
 * Mounting deliberately does *not* measure: the client that created the object wrote
 * its box, and a client that measured every object it drew would have every screen
 * rewrite every box on load.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  // The last measurement this client took responsibility for. Comparing against it
  // is what keeps a per-keystroke remeasure from re-writing an unchanged box.
  const measured = useRef<string | null>(null);

  const remeasureAfterLocalChange = useCallback(() => {
    measured.current = measureKey(doc, id);
    writeBox(doc, id, measure);
    measured.current = measureKey(doc, id);
  }, [doc, id, measure]);

  useEffect(() => {
    measured.current = measureKey(doc, id);

    const afterTransaction = (transaction: Y.Transaction) => {
      // Remote changes, and changes the undo manager replayed, carry their own box:
      // this client renders them, it does not re-measure them.
      if (transaction.origin !== LOCAL_ORIGIN) return;
      const key = measureKey(doc, id);
      if (key === null || key === measured.current) return;
      measured.current = key;
      writeBox(doc, id, measure);
      measured.current = measureKey(doc, id);
    };

    doc.on('afterTransaction', afterTransaction);
    return () => {
      doc.off('afterTransaction', afterTransaction);
    };
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
