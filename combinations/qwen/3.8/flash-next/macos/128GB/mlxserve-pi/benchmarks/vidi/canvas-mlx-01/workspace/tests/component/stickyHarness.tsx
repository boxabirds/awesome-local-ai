import { act, fireEvent, screen, within } from '@testing-library/react';
import type * as Y from 'yjs';
import {
  boardElement,
  flush,
  flushFrames,
  pointerEvent,
  renderBoard,
} from './harness.js';
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.js';
import type { StickyColor } from '../../src/shared/config.js';

/** The real `Y.Doc` the running app holds (registered by the test build). */
export const boardDoc = (): Y.Doc => {
  const doc = window.__vidi6?.getDoc();
  if (!doc) throw new Error('window.__vidi6.getDoc() is missing: run the component project in test mode');
  return doc as Y.Doc;
};

/** A fresh snapshot read straight from the model, not from the DOM. */
export const modelNotes = (): readonly StickySnapshot[] => snapshot(boardDoc());

export const modelNote = (id: string): StickySnapshot | undefined =>
  modelNotes().find((n) => n.id === id);

/** Render the whole app (board + notes + toolbars) for a sticky-note test. */
export function renderSticky(): void {
  renderBoard();
}

/** Add a note through the model and let React paint it. Returns its id. */
export async function seedNote(x = 0, y = 0, color?: StickyColor): Promise<string> {
  let id = '';
  act(() => {
    id = createSticky(boardDoc(), { x, y }, color);
  });
  await flush();
  return id;
}

/** Seed a note and give it text directly through its live `Y.Text`. */
export async function seedNoteText(id: string, text: string): Promise<void> {
  const doc = boardDoc();
  act(() => {
    const ytext = getStickyText(doc, id);
    if (ytext) doc.transact(() => ytext.insert(0, text));
  });
  await flush();
}

const escapeId = (id: string): string =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');

/** The DOM element of a note, or null when it is not rendered. */
export const noteEl = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-note-id="${escapeId(id)}"]`);

export const noteCount = (): number =>
  document.querySelectorAll('[data-note-id]').length;

export const isSelected = (id: string): boolean => noteEl(id)?.dataset.selected === 'true';

export const toolbarIn = (id: string): HTMLElement | null => {
  const el = noteEl(id);
  if (!el) return null;
  return (within(el).queryByTestId('note-toolbar') as HTMLElement | null) ?? null;
};

export const editorIn = (id: string): HTMLElement | null => {
  const el = noteEl(id);
  if (!el) return null;
  return (within(el).queryByTestId('sticky-textarea') as HTMLElement | null) ?? null;
};

/** Press a key on the editor textarea itself (so its React key handler sees it). */
export async function keyInEditor(id: string, key: string): Promise<void> {
  const ta = editorIn(id);
  if (!ta) throw new Error('editor not rendered');
  fireEvent.keyDown(ta, { key });
  await flush();
}

/** Simulate typing/pasting a whole value into the editor (fires React onChange). */
export async function typeInEditor(id: string, value: string): Promise<void> {
  const ta = editorIn(id) as HTMLTextAreaElement | null;
  if (!ta) throw new Error('editor not rendered');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  act(() => {
    if (setter) setter.call(ta, value);
    else ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

/** The editor textarea's caret bounds (for the caret-at-end assertion). */
export const editorCaret = (id: string): { start: number; end: number } => {
  const ta = editorIn(id) as HTMLTextAreaElement | null;
  if (!ta) throw new Error('editor not rendered');
  return { start: ta.selectionStart ?? -1, end: ta.selectionEnd ?? -1 };
};

/** Whether the editor textarea currently has focus. */
export const editorFocused = (): boolean =>
  document.activeElement instanceof HTMLTextAreaElement &&
  document.activeElement.getAttribute('data-testid') === 'sticky-textarea';

/** Press the left button on a note. */
export async function noteDown(id: string, x: number, y: number): Promise<void> {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  pointerEvent('pointerdown', el, x, y, 1);
  await flush();
}

export async function noteMove(id: string, x: number, y: number): Promise<void> {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  pointerEvent('pointermove', el, x, y, 1);
  await flushFrames();
}

export async function noteUp(id: string, x: number, y: number): Promise<void> {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  pointerEvent('pointerup', el, x, y, 0);
  await flush();
}

/** Fire a DOM `pointercancel` on the note (jsdom has no helper for it). */
export async function noteCancel(id: string): Promise<void> {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  el.dispatchEvent(new Event('pointercancel', { bubbles: true }));
  await flush();
}

/** Fire a DOM `dblclick` on a target (used for notes and the empty board). */
export async function dblClick(target: Element, x = 0, y = 0): Promise<void> {
  target.dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
  await flush();
}

export const dblClickNote = (id: string): Promise<void> => {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  return dblClick(el, 100, 100);
};

/** Click the board's Sticky note toolbar button. */
export async function clickCreateButton(): Promise<void> {
  fireEvent.click(screen.getByTestId('create-sticky'));
  await flush();
  await flushFrames();
}

/** Click a colour swatch or the delete button inside a note's toolbar. */
export async function clickSwatch(id: string, color: StickyColor): Promise<void> {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  fireEvent.click(within(el).getByTestId(`swatch-${color}`));
  await flush();
}

export async function clickNoteDelete(id: string): Promise<void> {
  const el = noteEl(id);
  if (!el) throw new Error('note not rendered');
  fireEvent.click(within(el).getByTestId('note-delete'));
  await flush();
}

export { screen, boardElement };
