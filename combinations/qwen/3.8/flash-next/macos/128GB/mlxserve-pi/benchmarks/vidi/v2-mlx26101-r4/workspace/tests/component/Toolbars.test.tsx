/**
 * Component tests for the two toolbars (story 2, TC-27, TC-28, TC-29).
 *
 * Both toolbars sit above the board, so a test that lets a click through to the
 * board would pass for the wrong reason: these tests check the board did not
 * pan, that a note was not made by accident and that a press on a tool never
 * becomes a drag of the note underneath.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { getStickyText } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';
import {
  camera,
  clickStickyButton,
  createSelectedNote,
  doc,
  doubleClickBoard,
  hasTextarea,
  noteElement,
  noteElements,
  pasteText,
  pointerDown,
  pointerUp,
  renderBoard,
  stickies,
  textarea,
  typeText,
} from './helpers/stickyBoard';
import { RETRO_NOTE, SHORT_NOTE } from '../fixtures/texts';

const HALF = STICKY_SIZE_WORLD / 2;

/** The middle of the board area, in screen units. */
function viewportCentre(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function swatch(color: StickyColor): HTMLElement {
  return screen.getByRole('button', { name: `${color.charAt(0).toUpperCase()}${color.slice(1)} colour` });
}

/** jsdom writes a hex colour back as rgb(), so compare it in that form. */
function rgb(hex: string): string {
  const bytes = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${bytes.join(', ')})`;
}

function currentSwatchColor(): string | null {
  return document.querySelector('[data-testid="note-toolbar"] [aria-pressed="true"]')?.getAttribute('data-color') ?? null;
}

describe('toolbars', () => {
  it('TC-27: choosing pink recolours the note and changes nothing else', async () => {
    renderBoard();
    await createSelectedNote(400, 300, SHORT_NOTE);
    const before = { ...stickies()[0] };

    expect(fireEvent.click(swatch('pink'))).toBe(true);

    await waitFor(() => expect(stickies()[0].color).toBe('pink'));
    const after = stickies()[0];
    expect(after.id).toBe(before.id);
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    // Still selected: only the colour went away as "just selected".
    expect(noteElement().dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('sticky-text').textContent).toBe(SHORT_NOTE);
    // And the note itself is painted with it.
    expect(noteElement().dataset.noteColor).toBe('pink');
    expect(noteElement().style.backgroundColor).toBe(rgb(STICKY_COLORS.pink));
  });

  it('TC-27b: the pressed swatch is the colour the note has', async () => {
    renderBoard();
    await createSelectedNote(400, 300);

    expect(currentSwatchColor()).toBe('yellow');
    fireEvent.click(swatch('pink'));
    await waitFor(() => expect(currentSwatchColor()).toBe('pink'));
    // Exactly one swatch reads as pressed, so the current colour is never ambiguous.
    expect(document.querySelectorAll('[data-testid="note-toolbar"] [aria-pressed="true"]')).toHaveLength(1);
    expect(swatch('yellow').getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-27c: a press on a swatch is not a board gesture, and a click recolours', async () => {
    renderBoard();
    await createSelectedNote(400, 300);
    const cameraBefore = camera();

    // A press that starts on the swatch must not become a board pan or a drag of
    // the note behind it, and must not start typing.
    pointerDown(swatch('pink'), 0, 0);
    const notPrevented = pointerUp(swatch('pink'), 0, 0);

    expect(hasTextarea()).toBe(false);
    expect(stickies()).toHaveLength(1);
    expect(stickies()[0].color).toBe('yellow');
    expect(camera()).toEqual(cameraBefore);
    // The toolbar stops the press: nothing reaches the board or the note behind it.
    expect(notPrevented).toBe(true);

    fireEvent.click(swatch('pink'));
    await waitFor(() => expect(stickies()[0].color).toBe('pink'));
    expect(camera()).toEqual(cameraBefore);
  });

  it('TC-28: the Sticky note button puts one note in the middle of the board and starts typing', async () => {
    renderBoard();

    expect(fireEvent.click(screen.getByTestId('create-sticky'))).toBe(true);

    await waitFor(() => expect(stickies()).toHaveLength(1));
    const centre = screenToWorld(camera(), viewportCentre());
    expect(stickies()[0].x).toBeCloseTo(centre.x - HALF, 6);
    expect(stickies()[0].y).toBeCloseTo(centre.y - HALF, 6);
    expect(stickies()[0].type).toBe('sticky');
    expect(stickies()[0].text).toBe('');
    // Editing straight away.
    expect(hasTextarea()).toBe(true);
    expect(document.activeElement).toBe(textarea());
  });

  it('TC-28b: the new note lands in the middle of the board that is looked at, not of the whole board', async () => {
    renderBoard();
    // Pan far away first: the new note belongs to the part of the board on screen.
    const far = { x: 5000, y: 5000, zoom: 1 };
    window.__vidi6?.setCamera(far);
    await waitFor(() => expect(camera()).toEqual(far));

    await clickStickyButton();

    const centre = screenToWorld(camera(), viewportCentre());
    expect(centre.x).toBeGreaterThan(5000);
    expect(stickies()[0].x).toBeCloseTo(centre.x - HALF, 6);
    expect(stickies()[0].y).toBeCloseTo(centre.y - HALF, 6);
  });

  it('TC-28c: the button says what it does, in its name and in its tooltip', async () => {
    renderBoard();
    const button = screen.getByTestId('create-sticky');

    // Story 9 puts the key in the name: a control whose accessible name is the thing to type for it is a
    // control a person can find from the keyboard without reading the tooltip first.
    expect(button.getAttribute('aria-label')).toBe('Sticky note (N)');
    expect(button.getAttribute('title')).toBe('Sticky note (N) — or double-click the board');
    // The button lives in a toolbar, so a screen reader says which group it is in.
    expect(button.closest('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Board tools');
  });

  it('TC-28d: pressing the button for each idea makes one note each', async () => {
    renderBoard();

    await clickStickyButton();
    typeText('first idea');
    await clickStickyButton();

    expect(stickies()).toHaveLength(2);
    expect(stickies().map((note) => note.text)).toEqual(['first idea', '']);
    // The newest note is on top and is the one being typed into.
    expect(stickies()[1].text).toBe('');
    expect(hasTextarea()).toBe(true);
    typeText('second idea');
    expect(stickies()[1].text).toBe('second idea');
  });

  it('TC-28e: clicking the button does not pan the board', async () => {
    renderBoard();
    const before = camera();

    pointerDown(screen.getByTestId('create-sticky'), 0, 0);
    pointerUp(screen.getByTestId('create-sticky'), 0, 0);

    // The press stops at the toolbar: the board did not pan and no note came of it.
    expect(camera()).toEqual(before);
    expect(stickies()).toHaveLength(0);

    fireEvent.click(screen.getByTestId('create-sticky'));
    await waitFor(() => expect(stickies()).toHaveLength(1));
    expect(camera()).toEqual(before);
  });

  it('TC-29: the bin deletes the note and lets go of it', async () => {
    renderBoard();
    await createSelectedNote(400, 300, 'throw away');
    await doubleClickBoard(700, 500);
    typeText(SHORT_NOTE);
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(stickies()).toHaveLength(2));
    // Select the first note again by pressing it.
    const doomed = noteElements()[0];
    const survivorId = noteElements()[1].dataset.noteId ?? '';
    pointerDown(doomed, 100, 100);
    pointerUp(doomed, 100, 100);
    await waitFor(() => expect(doomed.dataset.selected).toBe('true'));
    const doomedId = doomed.dataset.noteId ?? '';

    expect(fireEvent.click(screen.getByTestId('note-delete'))).toBe(true);

    await waitFor(() => expect(stickies()).toHaveLength(1));
    expect(stickies().map((note) => note.id)).toEqual([survivorId]);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(noteElements()).toHaveLength(1);
    // The note is really gone from the document, text and all.
    expect(getStickyText(doc(), doomedId)).toBeUndefined();
    expect(stickies()[0].text).toBe(SHORT_NOTE);
  });

  it('TC-29b: deleting leaves nothing selected, so Delete does not remove a second note', async () => {
    renderBoard();
    await createSelectedNote(300, 200, 'one');
    await doubleClickBoard(700, 500);
    typeText('two');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(stickies()).toHaveLength(2));

    fireEvent.click(screen.getByTestId('note-delete'));

    await waitFor(() => expect(stickies()).toHaveLength(1));
    // Nothing is selected now: pressing Delete must not take the other note with it.
    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(true);
    expect(stickies()).toHaveLength(1);
  });

  it('the bin is drawn from a button that says what it does', async () => {
    renderBoard();
    await createSelectedNote(400, 300);
    const bin = screen.getByTestId('note-delete');

    expect(bin.getAttribute('aria-label')).toBe('Delete note');
    expect(bin.getAttribute('title')).toBe('Delete note');
    expect(bin.getAttribute('type')).toBe('button');
  });

  it('every colour can be named, in its accessible name and in its tooltip', async () => {
    renderBoard();
    await createSelectedNote(400, 300);
    const swatches = screen.getAllByTestId(/^color-/);

    // The order is the order of STICKY_COLORS, which is the single source of the
    // palette and is the same order the document, the export and the settings use.
    expect(swatches.map((element) => element.getAttribute('data-color'))).toEqual([
      'yellow',
      'orange',
      'green',
      'blue',
      'pink',
      'violet',
    ]);
    for (const element of swatches) {
      const color = element.getAttribute('data-color') ?? '';
      const name = `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
      expect(element.getAttribute('aria-label')).toBe(name);
      expect(element.getAttribute('title')).toBe(name);
      expect(element.getAttribute('aria-pressed')).toBe(color === 'yellow' ? 'true' : 'false');
      expect(element.style.backgroundColor).toBe(rgb(STICKY_COLORS[color as StickyColor]));
    }
  });

  it('the note toolbar asks for six colours that the settings define', async () => {
    renderBoard();
    await createSelectedNote(400, 300);

    expect(Object.keys(STICKY_COLORS)).toHaveLength(6);
    expect(screen.getByTestId('note-toolbar').getAttribute('role')).toBe('toolbar');
    // The swatches are reached by keyboard, so they are ordinary buttons.
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
  });

  it('a swatch click after a long paste recolours without touching the text', async () => {
    renderBoard();
    await doubleClickBoard(400, 300);
    pasteText(RETRO_NOTE);
    // The toolbar is up only once the note is selected rather than typed into.
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('note-toolbar')).toBeInTheDocument());

    fireEvent.click(swatch('green'));

    await waitFor(() => expect(stickies()[0].color).toBe('green'));
    expect(stickies()[0].text).toBe(RETRO_NOTE);
  });
});
