import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSticky, deleteObject, getStickyText } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { cameraFromDom, dispatchKey, initialCamera, nextFrame, useFakeFrames } from './helpers';
import {
  click,
  docWithNote,
  editor,
  moveTo,
  noteEl,
  noteElements,
  noteToolbar,
  notesOf,
  press,
  release,
  renderApp,
  selectNote,
} from './stickyHelpers';

beforeEach(() => useFakeFrames());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sticky.interaction', () => {
  it('renders a note at its world position with its colour, unselected', () => {
    const { doc } = docWithNote('Faster onboarding');
    renderApp(doc);
    const el = noteEl();
    expect(el.style.left).toBe('-100px');
    expect(el.style.top).toBe('-100px');
    expect(el.style.width).toBe('200px');
    expect(el.style.backgroundColor).toBe('rgb(255, 245, 157)');
    expect(el.dataset.selected).toBe('false');
    expect(el).toHaveProperty('tabIndex', 0);
    expect(el.textContent).toContain('Faster onboarding');
    expect(noteToolbar()).toBeNull();
  });

  it('TC-18 press and release without moving selects the note and shows the toolbar', () => {
    const { doc } = docWithNote('Faster onboarding');
    renderApp(doc);
    const el = selectNote();
    expect(el.dataset.selected).toBe('true');
    expect(noteToolbar()).not.toBeNull();
    expect(editor()).toBeNull();
  });

  it('TC-19 moving 2px (below DRAG_THRESHOLD_PX) is a click, not a move', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    const updates = vi.fn();
    doc.on('update', updates);
    const el = noteEl();
    press(el, 100, 100);
    moveTo(el, 102, 100);
    nextFrame();
    release(el, 102, 100);
    nextFrame();
    expect(updates).not.toHaveBeenCalled();
    expect(notesOf(doc)[0]).toMatchObject({ x: -100, y: -100 });
    expect(noteEl().dataset.selected).toBe('true');
  });

  it('TC-20 moving exactly DRAG_THRESHOLD_PX drags the note and never pans the board', () => {
    const { doc, id } = docWithNote();
    // Centred on (500, 500): top-left (400, 400).
    const other = createSticky(doc, { x: 500, y: 500 }) as string;
    renderApp(doc);
    const camera = cameraFromDom();
    const el = noteElements().find((n) => n.dataset.stickyId === id)!;
    press(el, 100, 100);
    moveTo(el, 100 + DRAG_THRESHOLD_PX, 100);
    nextFrame();
    expect(el.className).toContain('is-dragging');
    // bringToFront ran once: the dragged note is now on top.
    const notes = notesOf(doc);
    expect(notes[notes.length - 1].id).toBe(id);
    expect(noteToolbar()).toBeNull();
    moveTo(el, 150, 130);
    nextFrame();
    release(el, 150, 130);
    expect(notesOf(doc).find((n) => n.id === id)).toMatchObject({ x: -50, y: -70 });
    expect(notesOf(doc).find((n) => n.id === other)).toMatchObject({ x: 400, y: 400 });
    expect(cameraFromDom()).toEqual(camera);
    expect(cameraFromDom()).toEqual(initialCamera());
    expect(el.dataset.selected).toBe('true');
    expect(noteToolbar()).not.toBeNull();
  });

  it('drag distance is divided by the zoom so the note follows the pointer', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    act(() => window.__vidi6!.setCamera!({ x: -500, y: -400, zoom: 2 }));
    nextFrame();
    const el = noteEl();
    press(el, 100, 100);
    moveTo(el, 200, 150);
    release(el, 200, 150);
    expect(notesOf(doc).find((n) => n.id === id)).toMatchObject({ x: -50, y: -75 });
  });

  it('TC-21 pointercancel while dragging keeps the last applied position and selects', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    const el = noteEl();
    press(el, 100, 100);
    moveTo(el, 140, 120);
    nextFrame();
    expect(notesOf(doc)[0]).toMatchObject({ x: -60, y: -80 });
    // A move not yet drawn is dropped by the cancel.
    moveTo(el, 300, 300);
    fireEvent.pointerCancel(el, { pointerId: 1 });
    nextFrame();
    expect(notesOf(doc)[0]).toMatchObject({ x: -60, y: -80 });
    expect(el.dataset.selected).toBe('true');
    expect(el.className).not.toContain('is-dragging');
    moveTo(el, 500, 500);
    nextFrame();
    expect(notesOf(doc)[0]).toMatchObject({ x: -60, y: -80 });
  });

  it('TC-22 clicking empty board clears the selection', () => {
    const { doc } = docWithNote();
    const { viewport } = renderApp(doc);
    selectNote();
    click(viewport, 600, 600);
    expect(noteEl().dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
  });

  it('panning the board keeps the selection', () => {
    const { doc } = docWithNote();
    const { viewport } = renderApp(doc);
    selectNote();
    press(viewport, 600, 600);
    moveTo(viewport, 700, 650);
    nextFrame();
    release(viewport, 700, 650);
    expect(noteEl().dataset.selected).toBe('true');
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s deletes the selected note', (key) => {
    const { doc } = docWithNote('Duplicate idea');
    renderApp(doc);
    selectNote();
    const event = dispatchKey({ key });
    expect(event.defaultPrevented).toBe(true);
    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it('Delete with nothing selected deletes nothing', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    dispatchKey({ key: 'Delete' });
    expect(notesOf(doc)).toHaveLength(1);
  });

  it('TC-35 double-click on an existing note edits it instead of creating a note', () => {
    const { doc, id } = docWithNote('Faster onboarding');
    renderApp(doc);
    const el = noteEl();
    click(el);
    click(el);
    fireEvent.doubleClick(el, { clientX: 100, clientY: 100 });
    expect(notesOf(doc)).toHaveLength(1);
    expect(notesOf(doc)[0].id).toBe(id);
    expect(editor()).not.toBeNull();
    expect(document.activeElement).toBe(editor());
  });

  it('double-click on empty board creates a note centred there and starts editing', () => {
    const { viewport, doc } = renderApp();
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    const cam = initialCamera();
    const notes = notesOf(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      color: 'yellow',
      x: 400 + cam.x - 100,
      y: 300 + cam.y - 100,
      z: 1,
    });
    expect(document.activeElement).toBe(editor());
  });

  it('TC-36 Enter with nothing selected creates or edits nothing', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    const updates = vi.fn();
    doc.on('update', updates);
    const event = dispatchKey({ key: 'Enter' });
    expect(event.defaultPrevented).toBe(false);
    expect(editor()).toBeNull();
    expect(notesOf(doc)).toHaveLength(1);
    expect(updates).not.toHaveBeenCalled();
  });

  it('TC-37 note deleted while dragging: the drag ends silently and the note is not re-created', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    const el = noteEl();
    press(el, 100, 100);
    moveTo(el, 150, 100);
    nextFrame();
    moveTo(el, 180, 100);
    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
      nextFrame();
      moveTo(el, 220, 100);
      nextFrame();
      release(el, 220, 100);
    }).not.toThrow();
    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-37 note deleted while editing: editing ends without an error or a write', () => {
    const { doc, id } = docWithNote('Draft');
    renderApp(doc);
    const el = selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = editor()!;
    expect(textarea).not.toBeNull();
    const ytext = getStickyText(doc, id)!;
    const updates = vi.fn();
    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
      doc.on('update', updates);
      fireEvent.blur(textarea);
    }).not.toThrow();
    expect(updates).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(el.isConnected).toBe(false);
    expect(doc.getMap('objects').size).toBe(0);
    expect(ytext.toString()).toBe('');
    // Keys no longer act on the deleted note.
    dispatchKey({ key: 'Enter' });
    expect(doc.getMap('objects').size).toBe(0);
  });
});
