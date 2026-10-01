import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { cameraTransform, click, flush, notes, pointer, renderApp, viewport } from './helpers';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('sticky note interaction', () => {
  it('TC-18 press and release selects with outline and toolbar', () => {
    renderApp([{ x: 0, y: 0 }]);
    const [note] = notes();
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByLabelText('Delete note')).toBeNull();
    click(note, 500, 400);
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.style.outline).toContain('solid');
    expect(screen.getByLabelText('Delete note')).toBeTruthy();
    expect(screen.getByLabelText('Pink colour')).toBeTruthy();
  });

  it('TC-19 a 2px move stays a click and does not move the note', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    const before = snapshot(doc)[0];
    const [note] = notes();
    pointer('pointerdown', note, 500, 400);
    pointer('pointermove', note, 502, 400);
    flush();
    pointer('pointerup', note, 502, 400);
    expect(snapshot(doc)[0]).toEqual(before);
    expect(note.getAttribute('data-selected')).toBe('true');
  });

  it('TC-20 a 3px move drags the note and never pans the board', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }, { x: 50, y: 50 }]);
    const camera = cameraTransform();
    const [a] = notes();
    const before = snapshot(doc).find((n) => n.x === -100)!;
    pointer('pointerdown', a, 500, 400);
    pointer('pointermove', a, 503, 400);
    flush();
    expect(screen.queryByLabelText('Delete note')).toBeNull(); // toolbar hidden while dragging
    pointer('pointermove', a, 600, 450);
    flush();
    pointer('pointerup', a, 600, 450);
    const after = snapshot(doc).find((n) => n.id === before.id)!;
    expect(after.x).toBe(before.x + 100);
    expect(after.y).toBe(before.y + 50);
    expect(after.z).toBeGreaterThan(before.z);
    expect(cameraTransform()).toBe(camera);
    expect(screen.getByLabelText('Delete note')).toBeTruthy();
  });

  it('TC-21 pointercancel keeps the last applied position and selects', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    const [note] = notes();
    pointer('pointerdown', note, 500, 400);
    pointer('pointermove', note, 540, 400);
    flush();
    pointer('pointercancel', note, 540, 400);
    pointer('pointermove', note, 900, 400);
    flush();
    expect(snapshot(doc)[0].x).toBe(-100 + 40);
    expect(note.getAttribute('data-selected')).toBe('true');
  });

  it('TC-22 clicking empty board deselects', () => {
    renderApp([{ x: 0, y: 0 }]);
    const [note] = notes();
    click(note, 500, 400);
    expect(screen.getByLabelText('Delete note')).toBeTruthy();
    click(viewport(), 5, 5);
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByLabelText('Delete note')).toBeNull();
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s removes the selected note', (key) => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    click(notes()[0], 500, 400);
    fireEvent.keyDown(window, { key });
    expect(snapshot(doc)).toHaveLength(0);
    expect(notes()).toHaveLength(0);
  });

  it('TC-35 double-clicking a note edits it and creates nothing', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('double-clicking empty board creates a centred yellow note in edit mode', () => {
    const { doc } = renderApp();
    // initial camera centres the origin; viewport is 1024x768 in jsdom
    fireEvent.doubleClick(viewport(), { clientX: 612, clientY: 484 });
    const [n] = snapshot(doc);
    expect(n.color).toBe('yellow');
    expect(n.x + 100).toBe(100);
    expect(n.y + 100).toBe(100);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 a note deleted mid-drag ends the drag without error', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    const [note] = notes();
    pointer('pointerdown', note, 500, 400);
    pointer('pointermove', note, 520, 400);
    act(() => { deleteObject(doc, ids[0]); });
    expect(() => {
      pointer('pointermove', note, 560, 400);
      flush();
      pointer('pointerup', note, 560, 400);
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    expect(notes()).toHaveLength(0);
  });

  it('TC-37 a note deleted mid-edit ends the edit without error', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(() => act(() => { deleteObject(doc, ids[0]); })).not.toThrow();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getStickyText(doc, ids[0])).toBeUndefined();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
