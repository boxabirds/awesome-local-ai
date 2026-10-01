import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { click, first, frame, noteEl, noteEls, pointerDown, pointerMove, pointerUp, setupBoard, viewport, worldTransform } from './helpers';

afterEach(cleanup);

describe('sticky note interaction', () => {
  it('TC-18 click selects, showing outline and the note toolbar', () => {
    setupBoard([{ x: 0, y: 0 }]);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    click(noteEl());
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    expect(noteEl().style.outline).toContain('solid');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
  });

  it('TC-19 movement below the threshold selects without moving', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    const before = first(doc);
    pointerDown(noteEl(), 100, 100);
    pointerMove(noteEl(), 102, 100);
    pointerUp(noteEl(), 102, 100);
    await frame();
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    expect(first(doc).x).toBe(before.x);
  });

  it('TC-20 movement at the threshold drags the note and never pans the board', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    const before = first(doc);
    const camera = worldTransform();
    pointerDown(noteEl(), 100, 100);
    pointerMove(noteEl(), 103, 100);
    await frame();
    expect(first(doc).x).toBe(before.x + 3);
    pointerUp(noteEl(), 103, 100);
    expect(worldTransform()).toBe(camera);
  });

  it('TC-21 pointercancel keeps the last applied position and selects', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    const before = first(doc);
    pointerDown(noteEl(), 100, 100);
    pointerMove(noteEl(), 120, 110);
    await frame();
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    fireEvent.pointerCancel(noteEl(), { pointerId: 1 });
    expect(first(doc).x).toBe(before.x + 20);
    expect(first(doc).y).toBe(before.y + 10);
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('dragging brings the note to the front', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const low = ids[0];
    const el = noteEls().find((e) => e.getAttribute('data-note-id') === low)!;
    pointerDown(el, 100, 100);
    pointerMove(el, 110, 100);
    await frame();
    pointerUp(el, 110, 100);
    expect(snapshot(doc).at(-1)!.id).toBe(low);
  });

  it('TC-22 clicking empty board clears the selection', () => {
    setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    click(viewport(), 700, 600);
    expect(noteEl().getAttribute('data-selected')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s removes the selected note', (key) => {
    setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    fireEvent.keyDown(document.body, { key });
    expect(noteEls()).toHaveLength(0);
  });

  it('TC-35 double-clicking a note edits it and creates nothing', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('double-clicking empty board creates a centred, editing note', () => {
    const { doc } = setupBoard();
    fireEvent.doubleClick(viewport(), { clientX: 400, clientY: 300 });
    const [n] = snapshot(doc);
    // starting camera is {-512, -384}: world = screen + camera
    expect(n.x + 100).toBe(400 - 512);
    expect(n.y + 100).toBe(300 - 384);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 note deleted mid-drag ends the interaction quietly', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    pointerDown(noteEl(), 100, 100);
    pointerMove(noteEl(), 120, 100);
    await frame();
    const el = noteEl();
    act(() => {
      deleteObject(doc, ids[0]);
    });
    expect(() => {
      pointerMove(el, 150, 100);
      pointerUp(el, 150, 100);
    }).not.toThrow();
    await frame();
    expect(snapshot(doc)).toHaveLength(0);
    expect(noteEls()).toHaveLength(0);
  });

  it('TC-37 note deleted mid-edit removes the editor without recreating the note', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => {
      deleteObject(doc, ids[0]);
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
