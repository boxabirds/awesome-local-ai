import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { firePointer } from './helpers';

beforeEach(cleanup);

/** Create a doc with notes already in it (before undo controller exists). */
function makeDocWithNotes(notes: Array<{ id: string; x: number; y: number; color?: string }>) {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  doc.transact(() => {
    notes.forEach((n, i) => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', n.x);
      map.set('y', n.y);
      map.set('color', n.color ?? 'yellow');
      map.set('text', new Y.Text(''));
      map.set('z', i + 1);
      map.set('createdAt', 0);
      objects.set(n.id, map);
    });
  });
  return doc;
}

function renderBoard(doc: Y.Doc) {
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
    noteCount() {
      return snapshot(doc).length;
    },
    undoBtn() {
      return screen.getByLabelText('Undo') as HTMLButtonElement;
    },
    redoBtn() {
      return screen.getByLabelText('Redo') as HTMLButtonElement;
    },
  };
}

function getNotePos(doc: Y.Doc, id: string) {
  const s = snapshot(doc);
  const n = s.find((x) => x.id === id);
  return n ? { x: n.x, y: n.y } : null;
}

describe('Undo boundaries (TC-14 to TC-17)', () => {
  it('TC-14: 30-frame drag of a selection → one undo restores start positions', async () => {
    const doc = makeDocWithNotes([
      { id: 'a', x: 300, y: 300 },
      { id: 'b', x: 300, y: 600 },
    ]);
    const { settle, undoBtn } = renderBoard(doc);
    await settle();

    const startPosA = getNotePos(doc, 'a')!;
    const startPosB = getNotePos(doc, 'b')!;

    // Undo should be disabled (nothing done yet)
    expect(undoBtn().disabled).toBe(true);

    // Select A, then shift-select B
    const elA = screen.getByTestId('sticky-note-a');
    const elB = screen.getByTestId('sticky-note-b');
    firePointer(elA, 'pointerdown', 50, 50, { pointerId: 1 });
    firePointer(elA, 'pointerup', 50, 50, { pointerId: 1 });
    await settle();

    firePointer(elB, 'pointerdown', 50, 50, { pointerId: 2, shiftKey: true });
    firePointer(elB, 'pointerup', 50, 50, { pointerId: 2, shiftKey: true });
    await settle();

    // Drag both by starting on A (both selected)
    firePointer(elA, 'pointerdown', 50, 50, { pointerId: 3 });
    for (let i = 1; i <= 30; i++) {
      firePointer(elA, 'pointermove', 50 + i * 5, 50 + i * 5, { pointerId: 3 });
    }
    firePointer(elA, 'pointerup', 200, 200, { pointerId: 3 });
    await settle();

    // Positions should have moved
    const midPosA = getNotePos(doc, 'a')!;
    expect(midPosA.x).not.toBe(startPosA.x);

    // Undo button should be enabled
    expect(undoBtn().disabled).toBe(false);

    // One undo should restore BOTH to their starting positions
    act(() => { undoBtn().click(); });
    await settle();

    const restoredA = getNotePos(doc, 'a')!;
    const restoredB = getNotePos(doc, 'b')!;
    expect(restoredA.x).toBeCloseTo(startPosA.x, 0);
    expect(restoredA.y).toBeCloseTo(startPosA.y, 0);
    expect(restoredB.x).toBeCloseTo(startPosB.x, 0);
    expect(restoredB.y).toBeCloseTo(startPosB.y, 0);
  });

  it('TC-15: drag ends, colour changed later → two separate steps', async () => {
    const doc = makeDocWithNotes([{ id: 'x', x: 300, y: 300 }]);
    const { settle, undoBtn } = renderBoard(doc);
    await settle();

    const startPos = getNotePos(doc, 'x')!;

    // Drag the note
    const el = screen.getByTestId('sticky-note-x');
    firePointer(el, 'pointerdown', 50, 50, { pointerId: 1 });
    firePointer(el, 'pointermove', 100, 100, { pointerId: 1 });
    firePointer(el, 'pointermove', 200, 200, { pointerId: 1 });
    firePointer(el, 'pointerup', 200, 200, { pointerId: 1 });
    await settle();

    const movedPos = getNotePos(doc, 'x')!;
    expect(movedPos.x).not.toBe(startPos.x);

    // Select and change colour
    firePointer(el, 'pointerdown', 50, 50, { pointerId: 2 });
    firePointer(el, 'pointerup', 50, 50, { pointerId: 2 });
    await settle();
    const pinkBtn = screen.getByTestId('color-pink');
    await act(async () => { pinkBtn.click(); });
    await settle();

    // Undo once → should undo the colour change (note still at moved position)
    act(() => { undoBtn().click(); });
    await settle();

    let pos = getNotePos(doc, 'x')!;
    expect(pos.x).toBeCloseTo(movedPos.x, 0);
    const snap1 = snapshot(doc).find((n) => n.id === 'x')!;
    expect(snap1.color).toBe('yellow'); // colour undone

    // Undo again → should undo the drag (note back at start)
    act(() => { undoBtn().click(); });
    await settle();

    pos = getNotePos(doc, 'x')!;
    expect(pos.x).toBeCloseTo(startPos.x, 0);
    expect(pos.y).toBeCloseTo(startPos.y, 0);
  });

  it('TC-16: Ctrl+Z inside editor undoes typing, not an earlier move', async () => {
    const doc = makeDocWithNotes([{ id: 'x', x: 300, y: 300 }]);
    const { settle } = renderBoard(doc);
    await settle();

    const startPos = getNotePos(doc, 'x')!;

    // Move the note (step 1)
    const el = screen.getByTestId('sticky-note-x');
    firePointer(el, 'pointerdown', 50, 50, { pointerId: 1 });
    firePointer(el, 'pointermove', 150, 150, { pointerId: 1 });
    firePointer(el, 'pointerup', 150, 150, { pointerId: 1 });
    await settle();

    const movedPos = getNotePos(doc, 'x')!;
    expect(movedPos.x).not.toBe(startPos.x);

    // Double-click to edit
    await act(async () => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    await settle();

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    // Type "hello"
    await act(async () => {
      textarea.value = 'hello';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();

    // Ctrl+Z inside the editor → undoes typing only
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
      }));
    });
    await settle();

    // Text should be gone (typing undone)
    expect(textarea.value).toBe('');

    // The move should NOT be undone (note still at moved position)
    const currentPos = getNotePos(doc, 'x')!;
    expect(currentPos.x).toBeCloseTo(movedPos.x, 0);
    expect(currentPos.y).toBeCloseTo(movedPos.y, 0);
  });

  it('TC-17: pointercancel mid-drag → one step restoring start', async () => {
    const doc = makeDocWithNotes([{ id: 'x', x: 300, y: 300 }]);
    const { settle, undoBtn } = renderBoard(doc);
    await settle();

    const startPos = getNotePos(doc, 'x')!;

    // Start a drag, move past threshold, then cancel
    const el = screen.getByTestId('sticky-note-x');
    firePointer(el, 'pointerdown', 50, 50, { pointerId: 1 });
    // Move past threshold so drag begins (writes to Y.Doc)
    firePointer(el, 'pointermove', 100, 100, { pointerId: 1 });
    firePointer(el, 'pointermove', 150, 150, { pointerId: 1 });
    // Cancel
    firePointer(el, 'pointercancel', 150, 150, { pointerId: 1 });
    await settle();

    // There should be exactly one undo step
    expect(undoBtn().disabled).toBe(false);
    act(() => { undoBtn().click(); });
    await settle();

    // Should be restored to starting position
    const restoredPos = getNotePos(doc, 'x')!;
    expect(restoredPos.x).toBeCloseTo(startPos.x, 0);
    expect(restoredPos.y).toBeCloseTo(startPos.y, 0);
    // After that one undo, no more
    expect(undoBtn().disabled).toBe(true);
  });
});
