// Who is allowed to write a text object's box (`text.wrap`, Key decision 1).
//
// Only the client that *made* the change measures and writes the box. Measuring
// what arrived from somebody else would produce five writes for one change and —
// because the wrap is not perfectly invertible — would fight over the width. So
// this hook is called from the local paths only: right after a local keystroke,
// right after a local size change, right after a local handle drag. A change that
// came over the network arrives with its box already in it and is only drawn.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { useCallback, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { setTextSize, setTextBox, readTextSnapshot } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface TextBoxSync {
  /** Measure the object's text and store the box. Local changes call this. */
  remeasureAfterLocalChange(): void;
}

/**
 * The box this object's text needs right now, or null when there is nothing to
 * write: no object, no text, or a box that is already exactly right.
 *
 * An `auto` object's width is part of the answer (it follows the text); a `fixed`
 * object's width is *kept* — dragging a side handle is the only thing that changes
 * it — and only the height follows the rewrap.
 */
export function measureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { width: number; height: number } | null {
  const snapshot = readTextSnapshot(doc, id);
  if (!snapshot) return null;
  const layout = layoutText({
    text: snapshot.text,
    size: snapshot.size,
    widthMode: snapshot.widthMode,
    width: snapshot.width,
    measure,
  });
  if (snapshot.width === layout.width && snapshot.height === layout.height) return null;
  return { width: layout.width, height: layout.height };
}

/**
 * The one place a size is changed *and* the box put right afterwards, so nobody can
 * do half of it. The position does not move: a bigger size grows down and to the
 * right from the corner that is already there.
 */
export function applyTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
  measure: Measurer,
): boolean {
  if (!setTextSize(doc, id, size)) return false;
  const box = measureTextBox(doc, id, measure);
  if (box) setTextBox(doc, id, box);
  return true;
}

/**
 * The component's handle on the box. `measure` is read through a ref so the caller
 * can hand in a fresh canvas measurer every render without that being a reason to
 * make a new callback.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const live = useRef({ doc, id, measure });
  live.current = { doc, id, measure };

  const remeasureAfterLocalChange = useCallback((): void => {
    const { doc, id, measure } = live.current;
    const box = measureTextBox(doc, id, measure);
    if (box) setTextBox(doc, id, box);
  }, []);

  return useMemo(() => ({ remeasureAfterLocalChange }), [remeasureAfterLocalChange]);
}
