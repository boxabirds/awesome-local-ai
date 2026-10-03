/**
 * Local-only text box sync (story 9, text.layout).
 *
 * The client that made a LOCAL change to a text object (typing, size change,
 * fixed-width drag) measures the new box and writes `width`/`height` in the
 * same undo capture window, so undo reverts text and box together. Remote
 * clients render the stored box and NEVER write dimensions — five clients
 * must not race to re-measure the same change (key decision 1).
 *
 * Implementation: subscribe to the doc's `update` event and react only to
 * updates whose origin is LOCAL_ORIGIN. The layout inputs (text, size, mode,
 * fixed width) are compared against the last seen values, so the echo of a
 * box write (or any unrelated local change, e.g. moving a note) never
 * produces a redundant `setTextBox` (TC-13).
 *
 * `remeasureAfterLocalChange()` forces the same recompute-and-write; it is
 * what the editor calls after input (the update listener covers it too —
 * the second pass sees unchanged inputs and writes nothing).
 */

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import { DEFAULT_TEXT_SIZE, type TextSize } from '../../shared/config';
import { layoutText, type Measurer } from './textLayout';

interface LayoutInputs {
  text: string;
  size: TextSize;
  mode: 'auto' | 'fixed';
  /** Stored width; an input only in fixed mode. */
  width: number;
  initialized: boolean;
}

function readInputs(doc: Y.Doc, id: string): LayoutInputs | null {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj) return null;
  const text = (obj.get('text') as Y.Text | undefined)?.toString() ?? '';
  const size = (obj.get('size') as TextSize) ?? DEFAULT_TEXT_SIZE;
  const mode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
  const width = (obj.get('width') as number) ?? 0;
  return { text, size, mode, width, initialized: true };
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): {
  remeasureAfterLocalChange(): void;
} {
  const inputsRef = useRef<LayoutInputs>({
    text: '',
    size: DEFAULT_TEXT_SIZE,
    mode: 'auto',
    width: 0,
    initialized: false,
  });
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    const inputs = readInputs(doc, id);
    if (!inputs) return; // object deleted meanwhile
    const prev = inputsRef.current;
    inputsRef.current = inputs;

    // No local change to the layout inputs (echo of a box write, unrelated
    // local edit) → no write (TC-13).
    if (
      prev.initialized &&
      prev.text === inputs.text &&
      prev.size === inputs.size &&
      prev.mode === inputs.mode &&
      (inputs.mode !== 'fixed' || prev.width === inputs.width)
    ) {
      return;
    }

    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const storedW = (obj.get('width') as number) ?? 0;
    const storedH = (obj.get('height') as number) ?? 0;
    const layout = layoutText(
      inputs.text,
      inputs.size,
      inputs.mode,
      inputs.mode === 'fixed' ? inputs.width : null,
      measureRef.current,
    );
    if (layout.width !== storedW || layout.height !== storedH) {
      setTextBox(doc, id, { width: layout.width, height: layout.height });
      inputsRef.current.width = layout.width;
    }
  }, [doc, id]);

  useEffect(() => {
    // Adopt the current state without writing (remote clients never write
    // dimensions; a local client's estimate gets replaced by the first edit).
    inputsRef.current = readInputs(doc, id) ?? {
      text: '',
      size: DEFAULT_TEXT_SIZE,
      mode: 'auto',
      width: 0,
      initialized: false,
    };

    const onLocalUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL_ORIGIN) return;
      remeasureAfterLocalChange();
    };
    doc.on('update', onLocalUpdate);
    return () => {
      doc.off('update', onLocalUpdate);
    };
  }, [doc, id, remeasureAfterLocalChange]);

  return { remeasureAfterLocalChange };
}
