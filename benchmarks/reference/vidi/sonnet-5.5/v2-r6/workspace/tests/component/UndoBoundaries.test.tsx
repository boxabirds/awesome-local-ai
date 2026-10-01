import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createSticky, moveObjects, snapshot } from '../../src/shared/board-model';
import { addNote, click, moveTo, noteEl, press, release, renderBoard } from './board';
import { flushFrame } from './helpers';

const undoKey = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
const selectAll = () => fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
const pos = (doc: ReturnType<typeof renderBoard>['doc'], id: string) => {
  const o = snapshot(doc).find((n) => n.id === id)!;
  return [o.x, o.y];
};

async function dragFrames(el: Element, from: [number, number], frames: number, cancel = false) {
  press(el, ...from);
  for (let i = 1; i <= frames; i++) {
    moveTo(el, from[0] + i * 5, from[1] + i * 3);
    await flushFrame();
  }
  if (cancel) fireEvent.pointerCancel(el, { pointerId: 1 });
  else release(el, from[0] + frames * 5, from[1] + frames * 3);
}

describe('undo step boundaries', () => {
  it('TC-14 a 30-frame drag of a selection is one undo step', async () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    const b = addNote(doc, 400, 0);
    const startA = pos(doc, a);
    const startB = pos(doc, b);
    // creation steps are separate from the drag
    act(() => { /* flush */ });
    selectAll();
    await dragFrames(noteEl(a), [10, 10], 30);
    expect(pos(doc, a)).not.toEqual(startA);
    undoKey();
    expect(pos(doc, a)).toEqual(startA);
    expect(pos(doc, b)).toEqual(startB);
  });

  it('TC-15 a drag followed by a colour change 200 ms later are two steps', async () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    const start = pos(doc, a);
    await dragFrames(noteEl(a), [10, 10], 5);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(snapshot(doc)[0].color).toBe('pink');
    undoKey();
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(pos(doc, a)).not.toEqual(start);
    undoKey();
    expect(pos(doc, a)).toEqual(start);
  });

  it('TC-16 Ctrl+Z inside the editor undoes typing only, not an earlier move', async () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    act(() => { moveObjects(doc, new Map([[a, { x: 300, y: 300 }]])); });
    click(noteEl(a));
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    await userEvent.type(ta, 'hello');
    expect(snapshot(doc)[0].text).toBe('hello');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(snapshot(doc)[0].text).toBe('');
    expect(ta.value).toBe('');
    expect(pos(doc, a)).toEqual([300, 300]);
  });

  it('TC-17 a cancelled drag is still one step restoring the start position', async () => {
    const { doc } = renderBoard();
    const a = addNote(doc, 0, 0);
    const start = pos(doc, a);
    await dragFrames(noteEl(a), [10, 10], 10, true);
    expect(pos(doc, a)).not.toEqual(start);
    undoKey();
    expect(pos(doc, a)).toEqual(start);
  });

  it('delete of several objects is one step; undo brings them all back', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    addNote(doc, 400, 0);
    act(() => { createSticky(doc, { x: 800, y: 0 }); });
    selectAll();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(0);
    undoKey();
    expect(snapshot(doc)).toHaveLength(3);
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(snapshot(doc)).toHaveLength(0);
  });
});
