/**
 * Component tests for the toolbars (design capability `sticky.toolbar`): the
 * sticky-note button, the six colour swatches and the bin button, with their
 * accessible names — and the rule that a click on a toolbar reaches the tool,
 * never the board underneath.
 */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { STICKY_BUTTON_HINT } from '../../src/client/board/Toolbar';
import { STICKY_COLOR_LABELS } from '../../src/client/objects/NoteToolbar';
import { RETRO_ITEM } from '../fixtures/texts';
import {
  board,
  click,
  doubleClick,
  noteText,
  pointer,
  renderBoard,
  renderedCamera,
  settle,
  type BoardFixture,
} from './harness';

const CENTRE = { x: 640, y: 400 }; // centre of the 1280 x 800 test viewport

/** Clicks a toolbar control and lets the board re-render. */
async function tap(el: HTMLElement): Promise<void> {
  fireEvent.click(el);
  await settle();
}

/** Selects a note with a press and release. */
async function select(fx: BoardFixture, id: string): Promise<void> {
  const el = fx.noteEl(id);
  if (!el) throw new Error('note is not rendered');
  await click(el, { x: 300, y: 200 });
}

describe('the note toolbar', () => {
  it('TC-27 repaints the note and nothing else about it', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const other = await fx.create(600, 0, 'blue');
    await fx.setText(id, RETRO_ITEM);
    await select(fx, id);

    const before = fx.noteBox(id);
    const otherBefore = fx.noteBox(other);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    await tap(screen.getByTestId('color-pink'));

    const after = fx.noteBox(id);
    expect(after.color).toBe('pink');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(noteText(fx, id)).toBe(RETRO_ITEM);
    expect(fx.selection().selectedId).toBe(id); // still selected after a colour click
    // The other note keeps its colour, position and stacking.
    expect(fx.noteBox(other)).toEqual(otherBefore);
    // The document agrees.
    expect(fx.notes().find((note) => note.id === id)?.color).toBe('pink');
    expect(fx.notes().find((note) => note.id === other)?.color).toBe('blue');
  });

  it('marks the current colour as pressed and moves the mark with a new choice', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await select(fx, id);

    const swatches = Object.keys(STICKY_COLORS);
    expect(swatches).toHaveLength(6);
    expect(screen.getByTestId(`color-${DEFAULT_STICKY_COLOR}`).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByTestId('color-pink').getAttribute('aria-pressed')).toBe('false');

    await tap(screen.getByTestId('color-violet'));
    expect(screen.getByTestId('color-violet').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId(`color-${DEFAULT_STICKY_COLOR}`).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('TC-29 deletes the note through the bin button and clears the selection', async () => {
    const fx = renderBoard();
    const doomed = await fx.create(0, 0);
    const survivor = await fx.create(600, 0);
    await select(fx, doomed);
    const survivorBefore = fx.noteBox(survivor);
    const camera = renderedCamera();

    await tap(screen.getByTestId('delete-note'));

    expect(fx.notes()).toHaveLength(1);
    expect(fx.noteEl(doomed)).toBeNull();
    expect(fx.selection().selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    // Only the deleted note is gone: the rest of the board is untouched.
    expect(fx.noteBox(survivor)).toEqual(survivorBefore);
    expect(renderedCamera()).toEqual(camera);
  });

  it('TC-29 deletes the note being edited without losing the board', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');
    doubleClick(el);
    await settle();
    // While editing the toolbar is hidden; the bin is for a selected note.
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    fireEvent.keyDown(fx.textArea(), { key: 'Escape' });
    await settle();
    await tap(screen.getByTestId('delete-note'));
    expect(fx.notes()).toHaveLength(0);
    expect(fx.selection().selectedId).toBeNull();
  });

  it('names every control for assistive technology and the mouse', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await select(fx, id);

    for (const [name, label] of Object.entries(STICKY_COLOR_LABELS)) {
      const swatch = screen.getByTestId(`color-${name}`);
      expect(swatch.getAttribute('aria-label')).toBe(`${label} colour`);
      expect(swatch.getAttribute('title')).toBe(label);
    }
    const bin = screen.getByTestId('delete-note');
    expect(bin.getAttribute('aria-label')).toBe('Delete note');
    expect(bin.getAttribute('title')).toBe('Delete note');
    expect(screen.getByTestId('note-toolbar').getAttribute('role')).toBe('toolbar');
  });

  it('leaves the camera and the selection alone when a swatch is clicked', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await select(fx, id);
    const camera = renderedCamera();

    // The swatch swallows the press, so the board never starts panning and the
    // click does not reach the empty board space behind the toolbar.
    const swatch = screen.getByTestId('color-green');
    pointer('pointerDown', swatch, { x: 10, y: 10 });
    await settle();
    expect(board().dataset['panning']).toBe('false');
    pointer('pointerUp', swatch, { x: 10, y: 10 });
    await tap(swatch);

    expect(renderedCamera()).toEqual(camera);
    expect(fx.selection().selectedId).toBe(id);
    expect(fx.noteBox(id).color).toBe('green');
  });
});

describe('the left toolbar', () => {
  it('TC-28 creates a note in the middle of the visible board area and starts editing', async () => {
    const fx = renderBoard();
    const camera = renderedCamera();
    expect(camera.zoom).toBe(1);

    await tap(screen.getByTestId('create-sticky'));

    expect(fx.notes()).toHaveLength(1);
    const note = fx.notes()[0];
    if (!note) throw new Error('no note was created');
    // The visible world spans (-640, -400) to (640, 400) at 100 %; the note of
    // size 200 centred on it starts at (-100, -100).
    const middle = screenToWorld(camera, CENTRE);
    expect(middle).toEqual({ x: 0, y: 0 });
    expect(note.x).toBe(middle.x - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(middle.y - STICKY_SIZE_WORLD / 2);
    expect(fx.noteBox(note.id)).toMatchObject({ x: -100, y: -100, color: DEFAULT_STICKY_COLOR });
    // It comes up ready to type.
    expect(fx.selection().editingId).toBe(note.id);
    expect(document.activeElement).toBe(fx.textArea());
    expect(renderedCamera()).toEqual(camera); // creating a note never moves the camera
  });

  it('TC-28 keeps centring the new note after the board has been panned and zoomed', async () => {
    const fx = renderBoard();
    pointer('pointerDown', board(), { x: 640, y: 400 });
    pointer('pointerMove', board(), { x: 140, y: 100 });
    pointer('pointerUp', board(), { x: 140, y: 100 });
    await settle();
    fireEvent.wheel(board(), { ctrlKey: true, deltaY: -100 });
    await settle();
    const camera = renderedCamera();

    await tap(screen.getByTestId('create-sticky'));
    const note = fx.notes().at(-1);
    if (!note) throw new Error('no note was created');
    // Whatever the camera is, the new note is centred on the middle of the screen.
    const middle = screenToWorld(camera, CENTRE);
    expect(note.x).toBeCloseTo(middle.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(middle.y - STICKY_SIZE_WORLD / 2, 6);
  });

  it('shows the exact tooltip text and an accessible name on the button', () => {
    renderBoard();
    const button = screen.getByTestId('create-sticky');
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
    expect(STICKY_BUTTON_HINT).toBe('Sticky note – or double-click the board');
    expect(button.getAttribute('aria-label')).toBe('Sticky note');
    expect(screen.getByTestId('board-toolbar').getAttribute('role')).toBe('toolbar');
    expect(screen.getByTestId('board-toolbar').getAttribute('aria-label')).toBe('Board tools');
  });

  it('does not pan the board or clear the selection when its own background is pressed', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await select(fx, id);
    const camera = renderedCamera();

    const toolbar = screen.getByTestId('board-toolbar');
    pointer('pointerDown', toolbar, { x: 20, y: 300 });
    pointer('pointerMove', toolbar, { x: 120, y: 360 });
    await settle();
    expect(board().dataset['panning']).toBe('false');
    pointer('pointerUp', toolbar, { x: 120, y: 360 });
    await settle();

    expect(renderedCamera()).toEqual(camera);
    expect(fx.selection().selectedId).toBe(id); // clicking the palette is not clicking the board
    expect(fx.notes()).toHaveLength(1);
  });

  it('creates a second note on a second click and stacks it above the first', async () => {
    const fx = renderBoard();
    await tap(screen.getByTestId('create-sticky'));
    const first = fx.notes()[0];
    // Finish editing the first note, then create another one.
    fireEvent.keyDown(fx.textArea(), { key: 'Escape' });
    await settle();
    await tap(screen.getByTestId('create-sticky'));

    expect(fx.notes()).toHaveLength(2);
    const second = fx.notes().at(-1);
    if (!first || !second) throw new Error('notes are missing');
    expect(second.z).toBeGreaterThan(first.z);
    expect(second.id).not.toBe(first.id);
  });
});

describe('double-click on empty board space', () => {
  it('creates a note centred on the point that was clicked', async () => {
    const fx = renderBoard();
    // A point in the lower-right quarter of the screen, with nothing on it.
    const screenPoint = { x: 900, y: 600 };
    doubleClick(board(), screenPoint);
    await settle();

    expect(fx.notes()).toHaveLength(1);
    const note = fx.notes()[0];
    if (!note) throw new Error('no note was created');
    const world = screenToWorld(renderedCamera(), screenPoint);
    expect(note.x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 6);
    expect(fx.selection().editingId).toBe(note.id);
  });

  it('does not create a second note when the double-click lands on a note', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');
    doubleClick(el, { x: 300, y: 200 });
    await settle();
    expect(fx.notes()).toHaveLength(1);
    expect(fx.selection().editingId).toBe(id);
  });

  it('leaves the camera exactly where the story 1 pan left it', async () => {
    const fx = renderBoard();
    pointer('pointerDown', board(), { x: 640, y: 400 });
    pointer('pointerMove', board(), { x: 500, y: 300 });
    pointer('pointerUp', board(), { x: 500, y: 300 });
    await settle();
    const afterPan = renderedCamera();

    doubleClick(board(), { x: 400, y: 200 });
    await settle();
    expect(fx.notes()).toHaveLength(1);
    expect(renderedCamera()).toEqual(afterPan);
  });
});
