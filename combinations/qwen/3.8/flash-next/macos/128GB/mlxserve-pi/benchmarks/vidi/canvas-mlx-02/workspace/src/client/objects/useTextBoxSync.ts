// The text box keeps up with its text (story 9, text.layout / text.size_scale).
//
// A text object's HEIGHT is computed, and its AUTO WIDTH is computed too, so
// every local write that changes what the text lays out to - typing, the size
// toolbar, a side-handle drag, a commit from the editor - is followed by a
// re-measure that writes the new box. The three rules this hook exists to hold:
//
//  * it listens on the doc's update events and re-measures for LOCAL_ORIGIN
//    ones only: a change from another client re-measures NOTHING here (the
//    writer's box arrived as data), and an undo's inverse is not a local
//    change either - the step back restores what the step forward wrote;
//  * the re-measure goes through `setTextBox`, which writes nothing when the
//    box already agrees - so the re-measure after every local transaction adds
//    no transaction, no wire message and no undo step of its own (TC-13);
//  * the measurer is injected, because a DOM node cannot answer "how wide is
//    this string" until it has been laid out: the object component measures
//    with a canvas (textLayout.ts), the unit and component suites with a fake.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectsMapOf } from '../../shared/board-model.ts';
import { setTextBox } from '../../shared/objects/text.ts';
import { createCanvasMeasurer, layoutText } from './textLayout.ts';
import type { TextMeasurer } from './textLayout.ts';

export interface TextBoxSync {
  /**
   * Recompute the box after a LOCAL change. When it already agrees with the
   * stored box this writes nothing at all - no transaction, nothing on the
   * wire, no undo step.
   */
  remeasureAfterLocalChange(): void;
}

/** Read the fields the layout needs from the stored map, live, at this moment. */
function readLayoutInputs(
  doc: Y.Doc,
  id: string,
): { text: string; size: string; mode: 'auto' | 'fixed'; width: number | undefined } | null {
  const m = objectsMapOf(doc).get(id);
  if (!m || m.get('type') !== 'text') return null;
  const ytext = m.get('text');
  if (!(ytext instanceof Y.Text)) return null;
  const size = m.get('size');
  const mode: 'auto' | 'fixed' = m.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const width = m.get('width');
  return {
    text: ytext.toString(),
    size: typeof size === 'string' ? size : 'M',
    mode,
    width: mode === 'fixed' ? Number(width) : undefined,
  };
}

/**
 * Keep the text object's box equal to what its text lays out to. The returned
 * handle's `remeasureAfterLocalChange` is the explicit door the editor commits
 * through; the subscription is the automatic one, so a write made from the
 * size toolbar or the resize gesture re-measures in the same tick, inside the
 * same undo capture window as the write itself.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure?: TextMeasurer): TextBoxSync {
  const created = useRef<TextMeasurer | null>(null);
  if (created.current === null) created.current = createCanvasMeasurer();
  const measurer = measure ?? created.current;

  const remeasure = useCallback((): void => {
    const input = readLayoutInputs(doc, id);
    if (!input) return; // the object is gone, or was never a text
    const layout = layoutText(input.text, input.size, input.mode, input.width, measurer);
    // setTextBox writes nothing when the box already agrees; and when it does
    // write it is a LOCAL_ORIGIN transaction, which is what puts the
    // re-measure inside the same undo step as the change that caused it.
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }, [doc, id, measurer]);

  // Every LOCAL transaction touching this doc - typing, a size press, a
  // handle drag, an editor commit - re-measures this text. Another client's
  // change carries its own origin and is left alone: nothing about a text I
  // did not write rewrites the box on my tab (TC-12).
  useEffect(() => {
    const onLocalUpdate = (_update: Uint8Array, origin: unknown): void => {
      if (origin !== LOCAL_ORIGIN) return;
      remeasure();
    };
    doc.on('update', onLocalUpdate);
    return () => {
      doc.off('update', onLocalUpdate);
    };
  }, [doc, remeasure]);

  return useMemo<TextBoxSync>(() => ({ remeasureAfterLocalChange: remeasure }), [remeasure]);
}
