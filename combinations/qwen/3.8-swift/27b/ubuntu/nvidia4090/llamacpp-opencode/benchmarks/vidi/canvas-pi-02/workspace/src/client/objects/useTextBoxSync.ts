// Local-only text box sync (story 9, text.box_sync): the client that made a
// local change (typing, size, side handle) measures the object and writes
// width/height with setTextBox — and ONLY then.
//
// Key rule (text.box_sync): remote changes are NEVER re-measured here.
// `remeasureTextObject` is only ever called for local changes (editor input,
// setTextSize, side-handle drag); remote updates render with the sender's
// stored box.

import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { setTextBox, textSnapshot } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Re-measures one text object and writes its stored box when it changed.
 * Returns true when a box write happened.
 */
export function remeasureTextObject(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const snap = textSnapshot(doc, id);
  if (snap === null) return false;
  const fixedWidth = snap.widthMode === 'fixed' ? snap.width : null;
  const layout = layoutText(snap.text, snap.size, snap.widthMode, fixedWidth, measure);
  if (layout.width === snap.width && layout.height === snap.height) return false;
  return setTextBox(doc, id, layout);
}

export interface TextBoxSyncApi {
  /** Measures the object and writes the box if it changed. Called only for
   *  local changes: after every committed editor input, after a local size
   *  change, and on each side-handle drag flush. No-op when the remeasured
   *  box equals the stored box (no redundant updates). */
  remeasureAfterLocalChange(): void;
}

/**
 * Binds a text object id to the shared measurer and exposes
 * `remeasureAfterLocalChange` for the local editor / toolbar / gesture
 * code. Stable identity across renders.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): TextBoxSyncApi {
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(id);
  idRef.current = id;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  return {
    remeasureAfterLocalChange: useCallback(() => {
      remeasureTextObject(docRef.current, idRef.current, measureRef.current);
    }, []),
  };
}
