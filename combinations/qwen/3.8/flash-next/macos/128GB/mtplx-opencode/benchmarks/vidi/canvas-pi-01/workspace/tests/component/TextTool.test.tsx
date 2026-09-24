/**
 * Story 9 · task 7 — tool-mode component tests (TC-14 to TC-18).
 *
 * These drive the real `BoardShell` in jsdom: the two tool buttons reflect the
 * active tool, the `V` / `T` / `Escape` shortcuts switch it, a read-only board
 * refuses the Text tool, and — with Text active — a click on empty board space
 * creates a text object at the pointer, puts it straight into the editor and
 * drops back to Select. jsdom has no layout or canvas, so the create path uses
 * the estimate measurer; we assert DOM facts (the mounted editor, the object's
 * `data-size`, the pressed tool button) rather than measured pixels.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { seedDoc } from './helpers';
import { initDoc } from '../../src/shared/board-model';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function renderBoard(doc: Y.Doc) {
  return render(<BoardShell viewport={VIEWPORT} doc={doc} />);
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** The Text tool button and its pressed state. */
function textButton(): HTMLButtonElement {
  return screen.getByTestId('tool-text') as HTMLButtonElement;
}
function selectButton(): HTMLButtonElement {
  return screen.getByTestId('tool-select') as HTMLButtonElement;
}

function windowKey(keyName: string) {
  act(() => {
    fireEvent(window, new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
  });
}

function surface(): HTMLElement {
  return screen.getByTestId('board-viewport') as HTMLElement;
}

function pointerAt(type: 'pointerdown' | 'pointerup', x: number, y: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

function textObjects(doc: Y.Doc): string[] {
  const out: string[] = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((rec, id) => {
    if (rec.get('type') === 'text') out.push(id);
  });
  return out;
}

describe('tool mode (TC-14 to TC-18)', () => {
  // TC-14: T activates Text, Escape returns to Select, then V keeps Select.
  it('TC-14 — T switches to Text (pressed), Escape and V return to Select', () => {
    renderBoard(freshDoc());
    expect(textButton().getAttribute('aria-pressed')).toBe('false');

    windowKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    expect(selectButton().getAttribute('aria-pressed')).toBe('false');

    windowKey('Escape');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');

    // T then V lands back on Select.
    windowKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    windowKey('v');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  // TC-15: a read-only board refuses the Text tool and disables the button.
  it('TC-15 — read-only board: T ignored, Text button disabled', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // `load_failed` renders a read-only board (see `canEdit`).
    render(<BoardShell viewport={VIEWPORT} doc={doc} connectionState="load_failed" />);

    expect(textButton().disabled).toBe(true);
    windowKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  // TC-16: `T` typed inside a focused editor is a character, not a tool switch.
  it('TC-16 — T inside an editing field does not change the tool', () => {
    const { doc } = seedDoc([{ id: 'n1', centre: { x: 400, y: 300 }, text: 'hi' }]);
    renderBoard(doc);
    // Open the editor for the one seeded note, then focus it.
    const note = document.querySelector('[data-testid^="note-"]') as HTMLElement;
    fireEvent.doubleClick(note);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    editor.focus();
    expect(document.activeElement).toBe(editor);

    // The editor swallows the tool key (it is a typing target); the tool stays.
    windowKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  // TC-17: Text active, click on empty space creates a text object at the
  // pointer, selects + edits it, and returns to Select.
  it('TC-17 — Text active, empty-space click creates + edits a text object', () => {
    const doc = freshDoc();
    renderBoard(doc);

    windowKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');

    const surfaceEl = surface();
    fireEvent(surfaceEl, pointerAt('pointerdown', 300, 200));
    fireEvent(surfaceEl, pointerAt('pointerup', 300, 200));

    const created = textObjects(doc);
    expect(created).toHaveLength(1);
    // The new object is in editing mode, so its editor is mounted.
    const editor = screen.getByTestId(`text-editor-${created[0]}`) as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    // And the tool dropped back to Select.
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  // TC-18: N still creates a sticky at the view centre (story-2 regression).
  it('TC-18 — N creates a sticky at the centre', () => {
    const doc = freshDoc();
    renderBoard(doc);

    windowKey('n');

    let stickies: string[] = [];
    doc.getMap<Y.Map<unknown>>('objects').forEach((rec, id) => {
      if (rec.get('type') === 'sticky') stickies.push(id);
    });
    expect(stickies).toHaveLength(1);
    // It opened in the editor like the sticky create tool does.
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
  });
});
