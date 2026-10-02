import { render, act } from '@testing-library/react';
import type * as Y from 'yjs';
import App from '../../src/client/App';
import { createSticky, getStickyText } from '../../src/shared/board-model';

/**
 * Renders the full App and exposes the board Y.Doc through the test hook,
 * so tests can create notes through the real board model.
 */
export function renderApp() {
  const utils = render(<App />);
  const doc = window.__vidi6!.getBoardDoc();
  return { ...utils, doc };
}

/** Creates a note through the board model (wrapped in act). */
export function createNote(doc: Y.Doc, at: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id: string | false = '';
  act(() => {
    id = createSticky(doc, at);
  });
  return id as string;
}

/** Sets a note's text directly through the Y.Text (test setup). */
export function setNoteText(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.delete(0, ytext.length);
      ytext.insert(0, text);
    }
  });
}
