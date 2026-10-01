import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deleteObject } from '../../src/shared/board-model';
import { addNote, click, drag, moveTo, noteEl, notes, press, release, renderBoard } from './board';
import { flushFrame, readCamera } from './helpers';

describe('sticky note interaction', () => {
  it('TC-18 a press without movement selects and shows the outline and toolbar', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    expect(noteEl(id).dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    click(noteEl(id), 50, 50);
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(noteEl(id).style.outline).toContain('solid');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
  });

  it('TC-19 2px of movement is still a click', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    const before = notes(doc)[0];
    press(noteEl(id), 50, 50);
    moveTo(noteEl(id), 52, 50);
    await flushFrame();
    release(noteEl(id), 52, 50);
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(notes(doc)[0].x).toBe(before.x);
    expect(notes(doc)[0].z).toBe(before.z);
  });

  it('TC-20 exactly 3px drags the note and never pans the board', async () => {
    const { doc, world } = renderBoard();
    const id = addNote(doc, 0, 0);
    const cam = readCamera(world);
    const before = notes(doc)[0];
    press(noteEl(id), 50, 50);
    moveTo(noteEl(id), 53, 50);
    await flushFrame();
    expect(notes(doc)[0].x).toBe(before.x + 3);
    expect(noteEl(id).dataset.dragging).toBe('true');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    release(noteEl(id), 53, 50);
    expect(readCamera(world)).toEqual(cam);
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('drag moves by the screen delta divided by zoom and brings the note to front', async () => {
    const { doc, viewport } = renderBoard();
    const a = addNote(doc, 0, 0);
    const b = addNote(doc, 50, 50);
    const topBefore = notes(doc).find((n) => n.id === b)!.z;
    const startA = notes(doc).find((n) => n.id === a)!;
    // zoom in 2x via ctrl+wheel is imprecise; use the keyboard step twice (1.25^2) and divide
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    await flushFrame();
    const zoom = 1.25 * 1.25;
    void viewport;
    await drag(noteEl(a), [100, 100], [200, 150]);
    const after = notes(doc).find((n) => n.id === a)!;
    expect(after.x).toBeCloseTo(startA.x + 100 / zoom, 6);
    expect(after.y).toBeCloseTo(startA.y + 50 / zoom, 6);
    expect(after.z).toBeGreaterThan(topBefore);
  });

  it('TC-21 pointercancel keeps the last applied position and selection', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    const start = notes(doc)[0];
    press(noteEl(id), 50, 50);
    moveTo(noteEl(id), 80, 50);
    await flushFrame();
    fireEvent.pointerCancel(noteEl(id), { pointerId: 1 });
    moveTo(noteEl(id), 300, 300);
    await flushFrame();
    expect(notes(doc)[0].x).toBe(start.x + 30);
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(noteEl(id).dataset.dragging).toBe('false');
  });

  it('TC-22 clicking empty board clears the selection', () => {
    const { doc, viewport } = renderBoard();
    const id = addNote(doc, 0, 0);
    click(noteEl(id));
    expect(noteEl(id).dataset.selected).toBe('true');
    click(viewport, 900, 700);
    expect(noteEl(id).dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s removes the selected note', (key) => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    click(noteEl(id));
    fireEvent.keyDown(window, { key });
    expect(notes(doc)).toHaveLength(0);
    expect(noteEl(id)).toBeNull();
  });

  it('TC-35 double-click on a note edits it instead of creating one', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id), { clientX: 10, clientY: 10 });
    expect(notes(doc)).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeTruthy();
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const { doc } = renderBoard();
    addNote(doc, 0, 0);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(notes(doc)).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('double-click on empty space creates a yellow centred note in edit mode', () => {
    const { doc, viewport } = renderBoard();
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    expect(notes(doc)).toHaveLength(1);
    const cam = readCamera(screen.getByTestId('board-world'));
    expect(notes(doc)[0].x + 100).toBeCloseTo(400 + cam.x, 6);
    expect(notes(doc)[0].y + 100).toBeCloseTo(300 + cam.y, 6);
    expect(notes(doc)[0].color).toBe('yellow');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-37 a note deleted mid-drag ends the drag quietly', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    press(noteEl(id), 50, 50);
    moveTo(noteEl(id), 80, 50);
    await flushFrame();
    act(() => { deleteObject(doc, id); });
    expect(noteEl(id)).toBeNull();
    expect(() => moveTo(document.body, 120, 50)).not.toThrow();
    await flushFrame();
    expect(notes(doc)).toHaveLength(0);
  });

  it('TC-37 a note deleted while editing leaves no editor and is not recreated', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id));
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    act(() => { deleteObject(doc, id); });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(() => fireEvent.blur(ta)).not.toThrow();
    await flushFrame();
    expect(notes(doc)).toHaveLength(0);
  });
});
