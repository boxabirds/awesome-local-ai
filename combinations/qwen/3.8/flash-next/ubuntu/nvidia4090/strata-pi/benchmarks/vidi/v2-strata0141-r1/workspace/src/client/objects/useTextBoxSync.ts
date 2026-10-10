import { useCallback, useMemo } from 'react';
import type * as Y from 'yjs';
import { readTextSnapshot, setTextBox } from '../../shared/objects/text';
import { layoutText, sharedMeasurer, type Measurer } from './textLayout';

/**
 * Writing the measured box, by the client that made the change (Key decision 1).
 *
 * Selection bounds, marquee and rendering all need `width`/`height` without
 * measuring, so every client must agree on the box - but only **one** may write
 * it. This module writes it for the local client only: after local typing, a
 * local size change or a local fixed-width drag. A remote change is rendered
 * from the box its author measured, and this client never re-measures it, which
 * is what keeps five simultaneous editors from each broadcasting a box for the
 * same text (TC-12).
 *
 * A remeasure that would change nothing writes nothing either (TC-13).
 */

/**
 * Measure `id`'s text now and store the box. `true` when a write happened,
 * `false` when the object is gone or the box is already correct.
 */
export function remeasureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): boolean {
  const snapshot = readTextSnapshot(doc, id);
  if (!snapshot) {
    return false; // deleted elsewhere mid-edit (TC-24 shape)
  }
  const layout = layoutText(
    snapshot.text,
    snapshot.size,
    snapshot.widthMode,
    snapshot.widthMode === 'fixed' ? snapshot.width : null,
    measure,
  );
  return setTextBox(doc, id, { width: layout.width, height: layout.height });
}

/** This board's measurer: a real canvas when there is one, the estimate otherwise. */
export function useMeasurer(custom?: Measurer): Measurer {
  // The shared one, so a board of a hundred text objects measures with one canvas
  // rather than a hundred (`text.height`).
  return useMemo(() => custom ?? sharedMeasurer(), [custom]);
}

export interface TextBoxSync {
  /** Call after a **local** change to this text object, never for a remote one. */
  remeasureAfterLocalChange(): void;
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure?: Measurer): TextBoxSync {
  const measurer = useMeasurer(measure);

  const remeasureAfterLocalChange = useCallback((): void => {
    remeasureTextBox(doc, id, measurer);
  }, [doc, id, measurer]);

  return { remeasureAfterLocalChange };
}
