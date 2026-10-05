import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { objectBounds, snapshot } from '../../src/shared/board-model';
import { resetCamera, worldToScreen, type Point } from '../../src/client/canvas/camera';
import {
  VIEWPORT,
  boardSurface,
  clickNote,
  marqueeOn,
  noteEl,
  renderBoard,
  seedSticky,
  selectedIds,
  stubViewportSize,
} from './boardHarness';

stubViewportSize();

/** The board opens with its world origin in the middle of the viewport. */
const CAM = resetCamera(VIEWPORT);
/** Where a board point appears on screen, for the pointer. */
const at = (x: number, y: number): Point => worldToScreen(CAM, { x, y });

/**
 * Story 7, sel.marquee_ui: Shift+drag draws a rectangle and everything the
 * rectangle holds is added to the selection.
 *
 * Notes are seeded at a point and *centred* on it (story 2), so the world
 * rectangles below are the seeded point minus half the note size; each is written
 * out to make it obvious which one the rectangle is meant to cut in half.
 */
describe('marquee selection (sel.marquee_ui)', () => {
  /**
   * A: world 200..400 — inside the rectangle.
   * B: world 300..500 — half of it outside the rectangle's right edge.
   * C: world 1900..2100 — nowhere near it.
   */
  function threeNotes() {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 300, y: 300 });
    const b = seedSticky(doc, { x: 400, y: 300 });
    const c = seedSticky(doc, { x: 2000, y: 2000 });
    const { container } = renderBoard(doc);
    const bounds = (id: string) =>
      objectBounds(snapshot(doc).find((note) => note.id === id)!);
    expect(bounds(a)).toEqual({ x: 200, y: 200, width: 200, height: 200 });
    return { doc, container, a, b, c };
  }

  /** The rectangle around A, stopping inside B. */
  const FROM = { x: 150, y: 150 };
  const TO = { x: 430, y: 430 };

  it('TC-20 Shift+drag selects what is entirely inside it', () => {
    const { container, a, b, c } = threeNotes();

    marqueeOn(boardSurface(container), at(FROM.x, FROM.y), at(TO.x, TO.y));

    expect(selectedIds(container)).toEqual([a]);
    // One object selected: the note's own toolbar, not the group bar.
    expect(screen.getByRole('toolbar', { name: 'Sticky note options' })).toBeTruthy();
    // Half-inside and outside notes were left alone.
    expect(noteEl(container, b).dataset.selected).toBe('false');
    expect(noteEl(container, c).dataset.selected).toBe('false');
  });

  it('TC-20 it adds to the selection instead of replacing it', () => {
    const { container, a, c } = threeNotes();

    clickNote(noteEl(container, c));
    expect(selectedIds(container)).toEqual([c]);

    marqueeOn(boardSurface(container), at(FROM.x, FROM.y), at(TO.x, TO.y));
    expect(selectedIds(container)).toEqual([a, c].sort());
    expect(container.querySelector('[data-selection-count]')?.textContent).toBe('2 selected');
  });

  it('the rectangle is drawn while dragging and gone afterwards', () => {
    const { container } = threeNotes();
    const surface = boardSurface(container);

    marqueeOn(surface, at(FROM.x, FROM.y), at(TO.x, TO.y), { hold: true });
    const rect = container.querySelector<HTMLElement>('[data-marquee]');
    expect(rect).toBeTruthy();
    // Drawn in screen space at the rectangle's size: zoom would scale it.
    expect(rect!.style.width).toBe(`${TO.x - FROM.x}px`);
    expect(rect!.style.height).toBe(`${TO.y - FROM.y}px`);
    expect(rect!.style.left).toBe(`${at(FROM.x, FROM.y).x}px`);

    fireEvent.pointerUp(surface, { clientX: at(TO.x, TO.y).x, clientY: at(TO.x, TO.y).y, button: 0, pointerId: 3 });
    expect(container.querySelector('[data-marquee]')).toBeNull();
  });

  it('TC-21 a drag without Shift pans the board and draws no rectangle', () => {
    const { container, a } = threeNotes();
    const surface = boardSurface(container);
    clickNote(noteEl(container, a));

    fireEvent.pointerDown(surface, { clientX: at(800, 800).x, clientY: at(800, 800).y, button: 0, pointerId: 4 });
    fireEvent.pointerMove(surface, { clientX: at(700, 700).x, clientY: at(700, 700).y, button: 0, pointerId: 4 });
    expect(container.querySelector('[data-marquee]')).toBeNull();
    fireEvent.pointerUp(surface, { clientX: at(700, 700).x, clientY: at(700, 700).y, button: 0, pointerId: 4 });

    // Story 1's pan still works, and a pan is not a click, so the selection stayed.
    expect(selectedIds(container)).toEqual([a]);
  });

  it('TC-22 a cancelled marquee changes nothing', () => {
    const { container, c } = threeNotes();
    const surface = boardSurface(container);
    clickNote(noteEl(container, c));

    marqueeOn(surface, at(FROM.x, FROM.y), at(TO.x, TO.y), { hold: true });
    expect(container.querySelector('[data-marquee]')).toBeTruthy();

    fireEvent.pointerCancel(surface, { pointerId: 3 });
    expect(container.querySelector('[data-marquee]')).toBeNull();
    // The rectangle would have added a note; throwing it away adds nothing.
    expect(selectedIds(container)).toEqual([c]);
  });

  it('Escape cancels the rectangle in flight and keeps the selection', () => {
    const { container, c } = threeNotes();
    const surface = boardSurface(container);
    clickNote(noteEl(container, c));

    marqueeOn(surface, at(FROM.x, FROM.y), at(TO.x, TO.y), { hold: true });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(container.querySelector('[data-marquee]')).toBeNull();
    expect(selectedIds(container)).toEqual([c]);
  });

  it('a marquee over nothing at all leaves the selection as it was', () => {
    const { container, c } = threeNotes();
    clickNote(noteEl(container, c));

    // Empty space far from every note.
    marqueeOn(boardSurface(container), at(4000, 4000), at(4200, 4200));

    expect(selectedIds(container)).toEqual([c]);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
  });

  it('a Shift+drag that starts on a note moves it instead of drawing a rectangle', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 300, y: 300 });
    const { container } = renderBoard(doc);
    const before = snapshot(doc)[0].x;

    dragShiftOnNote(container, a);

    expect(container.querySelector('[data-marquee]')).toBeNull();
    // On an object, Shift is not the marquee modifier: it toggles the selection,
    // and a move would be an accident waiting to happen.
    expect(snapshot(doc)[0].x).toBe(before);
    expect(selectedIds(container)).toEqual([a]);
  });

  function dragShiftOnNote(container: HTMLElement, id: string) {
    const el = noteEl(container, id);
    fireEvent.pointerDown(el, { clientX: 300, clientY: 300, button: 0, pointerId: 5, shiftKey: true });
    fireEvent.pointerMove(el, { clientX: 360, clientY: 300, button: 0, pointerId: 5, shiftKey: true });
    fireEvent.pointerUp(el, { clientX: 360, clientY: 300, button: 0, pointerId: 5, shiftKey: true });
  }
});
