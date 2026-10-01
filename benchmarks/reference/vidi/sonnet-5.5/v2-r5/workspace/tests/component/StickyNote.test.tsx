import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './TestApp';
import { createSticky, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { Harness, newDoc } from './helpers';

afterEach(cleanup);

function makeNote(doc = newDoc()) {
  const id = createSticky(doc, { x: 100, y: 100 }) as string;
  render(<Harness doc={doc} />);
  return { doc, id, note: screen.getByRole('group', { name: 'Sticky note' }) };
}

function click(el: Element) {
  fireEvent.pointerDown(el, { clientX: 5, clientY: 5, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 5, clientY: 5, pointerId: 1 });
}

describe('sticky note interaction', () => {
  it('TC-18 click selects and shows the note toolbar', () => {
    const { note } = makeNote();
    expect(note.dataset.selected).toBe('false');
    click(note);
    expect(note.dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('TC-19 2px movement is a click, not a drag', async () => {
    const { doc, id, note } = makeNote();
    const before = snapshot(doc)[0];
    fireEvent.pointerDown(note, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 7, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 7, clientY: 5, pointerId: 1 });
    expect(note.dataset.selected).toBe('true');
    expect(snapshot(doc).find((n) => n.id === id)).toEqual(before);
  });

  it('TC-20 3px movement drags the note by delta / zoom without panning', async () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    render(<Harness doc={doc} zoom={2} />);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    const before = snapshot(doc)[0];
    const down = fireEvent.pointerDown(note, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(down).toBe(true);
    fireEvent.pointerMove(note, { clientX: 8, clientY: 5, pointerId: 1 });
    expect(note.dataset.dragging).toBe('true');
    fireEvent.pointerUp(note, { clientX: 8, clientY: 5, pointerId: 1 });
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBeCloseTo(before.x + 1.5);
    expect(after.y).toBe(before.y);
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-20 dragging a note in the app does not move the camera', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    const world = screen.getByTestId('board-world');
    const transform = world.style.transform;
    const note = screen.getByRole('group', { name: 'Sticky note' });
    fireEvent.pointerDown(note, { clientX: 500, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 560, clientY: 430, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 560, clientY: 430, pointerId: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(world.style.transform).toBe(transform);
  });

  it('TC-21 pointercancel keeps the last applied position and selects', async () => {
    const { doc, id, note } = makeNote();
    const x0 = snapshot(doc)[0].x;
    fireEvent.pointerDown(note, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 45, clientY: 5, pointerId: 1 });
    await waitFor(() => expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(x0 + 40));
    fireEvent.pointerMove(note, { clientX: 95, clientY: 5, pointerId: 1 });
    fireEvent.pointerCancel(note, { pointerId: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(snapshot(doc)[0].x).toBe(x0 + 40);
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-22 clicking empty board clears the selection', () => {
    const { note } = makeNote();
    click(note);
    fireEvent.pointerDown(screen.getByTestId('empty-board'));
    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it('dragging brings the note to the front', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    const b = createSticky(doc, { x: 10, y: 10 }) as string;
    render(<Harness doc={doc} />);
    const el = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(Number(el(a).style.zIndex)).toBeLessThan(Number(el(b).style.zIndex));
    fireEvent.pointerDown(el(a), { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(el(a), { clientX: 20, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(el(a), { clientX: 20, clientY: 0, pointerId: 1 });
    expect(Number(el(a).style.zIndex)).toBeGreaterThan(Number(el(b).style.zIndex));
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s removes the selected note', async (key) => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeTruthy();
    fireEvent.keyDown(window, { key });
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
  });

  it('TC-35 dblclick on a note edits it and creates no new note', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.doubleClick(screen.getByRole('group', { name: 'Sticky note' }));
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('dblclick on empty board creates a note and starts editing', () => {
    render(<App />);
    fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: 400, clientY: 300 });
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 note deleted mid-drag ends the drag without error or re-creation', async () => {
    const { doc, id, note } = makeNote();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.pointerDown(note, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 45, clientY: 5, pointerId: 1 });
    act(() => { deleteObject(doc, id); });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('TC-37 note deleted mid-edit ends the edit without error or re-creation', () => {
    const { doc, id, note } = makeNote();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.doubleClick(note);
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => { deleteObject(doc, id); });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getStickyText(doc, id)).toBeUndefined();
    expect(snapshot(doc)).toHaveLength(0);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
