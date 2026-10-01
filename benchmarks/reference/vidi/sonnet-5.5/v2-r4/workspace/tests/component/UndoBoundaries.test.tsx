import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { getStickyText, snapshot, stickies } from '../../src/shared/board-model';
import { frame, noteEl, pointerDown, pointerMove, pointerUp, setupBoard } from './helpers';

afterEach(cleanup);

const colour = (d: Parameters<typeof snapshot>[0]) => stickies(d)[0].color;
const undoKey = () => fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
const pos = (doc: Parameters<typeof snapshot>[0]) => snapshot(doc).map((o) => ({ id: o.id, x: o.x, y: o.y }));

async function dragFrames(el: Element, from: number, frames: number) {
  pointerDown(el, from, 100);
  for (let i = 1; i <= frames; i++) {
    pointerMove(el, from + i * 5, 100 + i * 2);
    await frame();
  }
  return from + frames * 5;
}

describe('undo step boundaries', () => {
  it('TC-14 a 30-frame drag is one undo step restoring the start', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    const start = pos(doc);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    const end = await dragFrames(noteEl(0), 100, 30);
    pointerUp(noteEl(0), end, 160);
    expect(pos(doc)).not.toEqual(start);
    undoKey();
    expect(pos(doc)).toEqual(start);
    undoKey(); // nothing further to undo besides creation which predates the controller
    expect(pos(doc)).toEqual(start);
  });

  it('TC-15 a colour change right after a drag is a separate step', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    const start = pos(doc);
    const startColour = colour(doc);
    const end = await dragFrames(noteEl(0), 100, 5);
    pointerUp(noteEl(0), end, 110);
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    expect(colour(doc)).toBe('blue');
    undoKey();
    expect(colour(doc)).toBe(startColour);
    expect(pos(doc)).not.toEqual(start); // the move is still in place
    undoKey();
    expect(pos(doc)).toEqual(start);
  });

  it('TC-16 Ctrl+Z inside the editor undoes typing, not the earlier move', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    const end = await dragFrames(noteEl(0), 100, 5);
    pointerUp(noteEl(0), end, 110);
    const moved = pos(doc);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('hello');
    expect(getStickyText(doc, ids[0])!.toString()).toBe('hello');
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    expect(getStickyText(doc, ids[0])!.toString()).toBe('');
    expect(ta.value).toBe('');
    expect(pos(doc)).toEqual(moved);
  });

  it('TC-17 pointercancel mid-drag is still one step restoring the start', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    const start = pos(doc);
    await dragFrames(noteEl(0), 100, 10);
    act(() => {
      fireEvent.pointerCancel(window, { pointerId: 1 });
    });
    expect(pos(doc)).not.toEqual(start);
    undoKey();
    expect(pos(doc)).toEqual(start);
  });
});
