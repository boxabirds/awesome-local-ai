import { useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { getTextContent, setTextBox } from '../../shared/objects/text';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { TEXT_SIZES, type TextSize } from '../../shared/config';
import { layoutText, type Measurer } from './textLayout';

// Story 9: keep a text object's stored box in sync with its content.
// Key decision (design text.layout): dimensions are only ever written by the
// client that made the local change, never on remote updates, so five
// concurrent editors never race to write the same numbers.

// One-shot remeasure for call sites outside React (toolbar size change,
// fixed-width handle drag). No-op when the object is gone or the box is
// already correct.
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): void {
  const ytext = getTextContent(doc, id);
  if (ytext === undefined) return;
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (entry === undefined) return;
  const rawSize = entry.get('size');
  const widthMode = entry.get('widthMode');
  const storedWidth = entry.get('width');
  const storedHeight = entry.get('height');
  if (
    typeof rawSize !== 'string' ||
    !(rawSize in TEXT_SIZES) ||
    (widthMode !== 'auto' && widthMode !== 'fixed') ||
    typeof storedWidth !== 'number'
  ) {
    return;
  }
  const size = rawSize as TextSize;
  const layout = layoutText(
    ytext.toString(),
    size,
    widthMode,
    widthMode === 'fixed' ? storedWidth : null,
    measure
  );
  if (layout.width === storedWidth && layout.height === storedHeight) return;
  setTextBox(doc, id, { width: layout.width, height: layout.height });
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(
    () => remeasureText(doc, id, measure),
    [doc, id, measure]
  );

  // Local edits to this object's Y.Text also remeasure, so typing stays
  // correct even when a caller forgets to invoke the explicit hook. Remote
  // transactions carry a different origin and are ignored.
  useEffect(() => {
    const ytext = getTextContent(doc, id);
    if (ytext === undefined) return;
    const handler = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) remeasureText(doc, id, measure);
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
