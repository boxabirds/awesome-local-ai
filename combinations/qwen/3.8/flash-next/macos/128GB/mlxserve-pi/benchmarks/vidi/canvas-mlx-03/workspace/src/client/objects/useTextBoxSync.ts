// The single writer of a text object's box (story 9 `text.layout`).
//
// `layoutText` is pure; this hook wires it to the document. It exposes one action,
// `remeasureAfterLocalChange()`: lay the current text out with the injected
// `measurer` and `setTextBox` the result — but **only when the computed box differs
// from what is stored**. It is called by the local client only: after its own typing,
// after a size change, and after a fixed-width handle drag. Remote clients render the
// stored dimensions and never call it, so five people editing the same text never race
// to write five slightly different boxes for it (Key decision 1).
//
// The signature carries `doc` and `id` because the box it writes is a property of that
// object in that document; the text/size/mode are read from the document at call time,
// so it can never write a box for a stale text.

import { useCallback } from 'react';
import type * as Y from 'yjs';
import { setTextBox, textSnapshot } from '../../shared/objects/text.ts';
import { layoutText, type Measurer } from './textLayout.ts';

export interface TextBoxSync {
  /** Measure the object's current text and write the box, only if it changed. */
  remeasureAfterLocalChange(): void;
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasure = useCallback(() => {
    const snap = textSnapshot(doc, id);
    if (!snap) return; // deleted mid-edit: nothing to write
    const box = layoutText(snap.text, snap.size, snap.widthMode, snap.width, measure);
    // Only write when the box actually moved: no redundant updates (TC-13).
    if (Math.abs(box.width - snap.width) < 1e-6 && Math.abs(box.height - snap.height) < 1e-6) {
      return;
    }
    setTextBox(doc, id, { width: box.width, height: box.height });
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange: remeasure };
}
