import { screen } from '@testing-library/react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { type TextSnapshot, createText, getTextContent } from '../../src/shared/objects/text';
import type { Measurer } from '../../src/client/objects/textLayout';

/** Fake measurer: every character is half the font size wide (10 world units at M). */
export const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** A doc with one text object at world (x, y), optionally with content. */
export function docWithText(text = '', at = { x: 0, y: 0 }, doc = new Y.Doc()) {
  initDoc(doc);
  const id = createText(doc, at, 'g_test')!;
  if (text) getTextContent(doc, id)!.insert(0, text);
  return { doc, id };
}

export const textsOf = (doc: Y.Doc) =>
  objectsSnapshot(doc).filter((o): o is TextSnapshot => o.type === 'text');
export const textOf = (doc: Y.Doc, id: string) => textsOf(doc).find((t) => t.id === id);

export const textEl = (id: string) =>
  document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
export const textEditor = () => screen.queryByRole<HTMLTextAreaElement>('textbox', { name: 'Text' });

/** Counts this tab's own (LOCAL_ORIGIN) transactions that change the doc. */
export function countLocalWrites(doc: Y.Doc) {
  const counter = { n: 0 };
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN && tr.changed.size > 0) counter.n++;
  });
  return counter;
}

// jsdom has no canvas (it logs "Not implemented" for getContext): report none, so text is
// measured with the character-count estimate, as in any environment without canvas.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
