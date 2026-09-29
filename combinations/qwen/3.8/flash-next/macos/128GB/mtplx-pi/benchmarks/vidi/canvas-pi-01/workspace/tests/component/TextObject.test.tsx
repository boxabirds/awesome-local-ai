/**
 * Story 9 · task 9 — text-object component tests (a slice of TC-19 to TC-25).
 *
 * Drives the real `BoardShell` in jsdom. jsdom has no canvas, so the layout uses
 * the estimate measurer; the assertions are DOM facts about the created / edited
 * object (size preset, editor mount, the object vanishing when abandoned, undo
 * restoring text + box together), not measured pixels.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { initDoc } from '../../src/shared/board-model';
import { createText, getTextContent } from '../../src/shared/objects/text';

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

function windowKey(keyName: string) {
  act(() => {
    fireEvent(window, new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
  });
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

/** Activate the Text tool and click empty space to drop + edit a text box. */
function placeText(x = 300, y = 200): string {
  const doc = (globalThis as unknown as { __doc?: Y.Doc }).__doc!;
  windowKey('t');
  const surfaceEl = screen.getByTestId('board-viewport');
  fireEvent(surfaceEl, pointerAt('pointerdown', x, y));
  fireEvent(surfaceEl, pointerAt('pointerup', x, y));
  const ids = textObjects(doc);
  expect(ids).toHaveLength(1);
  return ids[0];
}

describe('text object (TC-19 to TC-25)', () => {
  // TC-19 / TC-20: an abandoned (empty) box is removed when editing ends.
  it('removes an empty text box on Escape', () => {
    const doc = freshDoc();
    (globalThis as unknown as { __doc?: Y.Doc }).__doc = doc;
    renderBoard(doc);

    const id = placeText();
    // It exists while editing.
    expect(textObjects(doc)).toHaveLength(1);

    // Escape ends editing with nothing typed → the box is discarded.
    const editor = screen.getByTestId(`text-editor-${id}`) as HTMLTextAreaElement;
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });
    expect(textObjects(doc)).toHaveLength(0);
  });

  // TC-19: typed text stays; the box is kept.
  it('keeps a text box that has content', () => {
    const doc = freshDoc();
    (globalThis as unknown as { __doc?: Y.Doc }).__doc = doc;
    renderBoard(doc);

    const id = placeText();
    const editor = screen.getByTestId(`text-editor-${id}`) as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(editor, { target: { value: 'Went well' } });
    });
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });
    expect(textObjects(doc)).toHaveLength(1);
    const ytext = getTextContent(doc, id);
    expect(ytext?.toString()).toBe('Went well');
  });

  // TC-21: the size toolbar starts at M and a size change keeps x/y.
  it('size toolbar shows M pressed and XL keeps x/y', () => {
    const doc = freshDoc();
    (globalThis as unknown as { __doc?: Y.Doc }).__doc = doc;
    renderBoard(doc);

    const id = placeText();
    // Type then end editing, so the object is selected (not editing) → toolbar.
    const editor = screen.getByTestId(`text-editor-${id}`) as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(editor, { target: { value: 'Title' } });
    });
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });

    // The single selected text shows its size toolbar with M pressed.
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    const m = screen.getByTestId('text-size-M') as HTMLButtonElement;
    const xl = screen.getByTestId('text-size-XL') as HTMLButtonElement;
    expect(m.getAttribute('aria-pressed')).toBe('true');
    expect(xl.getAttribute('aria-pressed')).toBe('false');

    const before = { x: Number(screen.getByTestId(`text-${id}`).dataset.x), y: Number(screen.getByTestId(`text-${id}`).dataset.y) };
    act(() => {
      fireEvent.click(xl);
    });
    const after = screen.getByTestId(`text-${id}`) as HTMLElement;
    expect(after.dataset.size).toBe('XL');
    expect(Number(after.dataset.x)).toBe(before.x);
    expect(Number(after.dataset.y)).toBe(before.y);
  });

  // TC-24: a remote delete during editing ends the session without error.
  it('ends editing when the object is deleted remotely', () => {
    const doc = freshDoc();
    (globalThis as unknown as { __doc?: Y.Doc }).__doc = doc;
    const id = createText(doc, { x: 200, y: 200 }, 'peer')!;
    renderBoard(doc);
    // Open the editor via the tool path would create a new one; instead drive
    // the existing object: double-click it to edit.
    const obj = screen.getByTestId(`text-${id}`);
    fireEvent.doubleClick(obj);
    expect(screen.getByTestId(`text-editor-${id}`)).toBeTruthy();

    // A remote peer deletes the object (no local origin).
    act(() => {
      doc.transact(() => {
        doc.getMap<Y.Map<unknown>>('objects').delete(id);
      });
    });
    // The editor unmounts and the object is gone — no crash, no recreation.
    expect(screen.queryByTestId(`text-editor-${id}`)).toBeNull();
    expect(textObjects(doc)).toHaveLength(0);
  });

  // TC-25: one Ctrl+Z restores text and its stored box together.
  it('one undo restores the text and its box', () => {
    const doc = freshDoc();
    (globalThis as unknown as { __doc?: Y.Doc }).__doc = doc;
    renderBoard(doc);

    const id = placeText();
    const editor = screen.getByTestId(`text-editor-${id}`) as HTMLTextAreaElement;
    // Widen the stored box to a known fixed width so a change is observable.
    act(() => {
      fireEvent.change(editor, { target: { value: 'Hello there friend many words to wrap around the box' } });
    });
    const grown = screen.getByTestId(`text-${id}`) as HTMLElement;
    const grownWidth = Number(grown.dataset.width ?? '0');

    // Undo the whole typing session (one step): text and its stored box revert
    // together because the box write shared the capture window.
    act(() => {
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    });
    const ytext = getTextContent(doc, id);
    expect(ytext?.toString()).toBe('');
    const reverted = screen.getByTestId(`text-${id}`) as HTMLElement;
    // The width shrank back with the text (the box undid in the same step).
    expect(Number(reverted.dataset.width)).toBeLessThan(grownWidth);
  });
});
