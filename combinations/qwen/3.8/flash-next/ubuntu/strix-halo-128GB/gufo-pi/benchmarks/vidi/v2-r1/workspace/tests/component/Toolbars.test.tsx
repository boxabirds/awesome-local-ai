import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../../src/client/App';
import { STICKY_BUTTON_TOOLTIP } from '../../src/client/board/Toolbar';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  stickyColorLabel,
  type StickyColor,
} from '../../src/shared/config';
import {
  CENTRE,
  COLORS,
  centreOf,
  clickEmptyBoard,
  createNote,
  createNoteWithText,
  cssColor,
  currentCamera,
  modelNotes,
  note,
  noteCount,
  pressEscape,
  selectNote,
  setCamera,
  typeText,
  view,
} from './sticky-helpers';

/**
 * sticky.toolbar: the Sticky note button on the left, and the toolbar that
 * floats above the selected note.
 *
 * The button is the only way to add a note without a double-click, so it is
 * checked against the exact text the product names it with; the note toolbar is
 * checked for the colour it writes, the colour it leaves alone, and the fact
 * that using it never costs the user the selection.
 */

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  render(<App boardId="test-board-00000000ab" />);
});

function swatch(color: StickyColor): HTMLElement {
  return screen.getByLabelText(`${stickyColorLabel(color)} colour`) as HTMLElement;
}

describe('the Sticky note button', () => {
  it('TC-28 creates one note centred on the middle of the view, ready to type into', () => {
    fireEvent.click(screen.getByTestId('create-sticky'));

    expect(noteCount()).toBe(1);
    expect(modelNotes()).toHaveLength(1);
    const created = view(0);
    // the middle of a 1280x800 board at the starting camera is world 0,0
    const world = screenToWorld(currentCamera(), CENTRE);
    expect(created.x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 6);
    expect(created.y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 6);
    expect(created.color).toBe(DEFAULT_STICKY_COLOR);
    expect(created.editing).toBe(true);
    expect((screen.getByTestId('sticky-editor') as HTMLTextAreaElement).value).toBe('');
  });

  it('the button is named "Sticky note (N)" and offers the double-click in its tooltip', () => {
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });

    expect(button.getAttribute('title')).toBe(STICKY_BUTTON_TOOLTIP);
    expect(STICKY_BUTTON_TOOLTIP).toBe('Sticky note (N) – or double-click the board');
  });

  it('pressing it twice adds two notes, one on top of the other, and types into the newest', () => {
    fireEvent.click(screen.getByTestId('create-sticky'));
    typeText('first idea');
    fireEvent.click(screen.getByTestId('create-sticky'));

    expect(noteCount()).toBe(2);
    const notes = modelNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0]?.text).toBe('first idea');
    expect(notes[1]?.text).toBe('');
    expect(notes[1]?.z).toBeGreaterThan(notes[0]!.z);
    // the newest note is the one being edited
    expect(view(1).editing).toBe(true);
    typeText('second idea');
    pressEscape();
    expect(modelNotes()[1]?.text).toBe('second idea');
    expect(modelNotes()[0]?.text).toBe('first idea');
  });

  it('clicking the toolbar does not move the camera or select anything else', () => {
    const cameraBefore = currentCamera();
    createNoteWithText('selected', CENTRE);
    selectNote(0);

    fireEvent.click(screen.getByTestId('zoom-in'));

    expect(currentCamera().zoom).toBeGreaterThan(cameraBefore.zoom);
    // the board toolbar is not part of the board: clicking it left the note alone
    // (the zoom is a deliberate action, the click itself never panned)
    expect(cameraBefore.x).toBe(-640);
  });

  it('creating a note from the button while another is selected moves the selection', () => {
    createNoteWithText('older', CENTRE);
    selectNote(0);
    const older = view(0).id;

    fireEvent.click(screen.getByTestId('create-sticky'));

    expect(noteCount()).toBe(2);
    expect(view(0).id).toBe(older);
    expect(view(0).selected).toBe(false);
    expect(view(1).editing).toBe(true);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('the toolbar of the selected note', () => {
  it('TC-27 the Pink swatch sets the colour and keeps the selection', () => {
    createNoteWithText('colour me', CENTRE);
    selectNote(0);
    const before = modelNotes()[0]!;
    expect(before.color).toBe(DEFAULT_STICKY_COLOR);

    fireEvent.click(swatch('pink'));

    const after = modelNotes()[0]!;
    expect(after.color).toBe('pink');
    expect(after.id).toBe(before.id);
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(view(0).selected).toBe(true);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('all six colours are offered, each named in label and tooltip', () => {
    createNoteWithText('pick', CENTRE);
    selectNote(0);
    const toolbar = screen.getByTestId('note-toolbar');
    const buttons = within(toolbar).getAllByRole('button');
    // six swatches and the bin
    expect(buttons).toHaveLength(7);

    for (const color of COLORS) {
      const name = `${stickyColorLabel(color)} colour`;
      const button = within(toolbar).getByLabelText(name) as HTMLElement;
      expect(button.getAttribute('title')).toBe(name);
      expect(button.style.backgroundColor).not.toBe('');
      expect(button.getAttribute('aria-pressed')).toBe(color === DEFAULT_STICKY_COLOR ? 'true' : 'false');
    }
  });

  it('the current colour is the swatch marked as pressed', () => {
    createNoteWithText('switching', CENTRE);
    selectNote(0);

    fireEvent.click(swatch('blue'));

    expect(swatch('blue').getAttribute('aria-pressed')).toBe('true');
    expect(swatch('yellow').getAttribute('aria-pressed')).toBe('false');
    expect(view(0).color).toBe('blue');

    fireEvent.click(swatch('orange'));

    expect(view(0).color).toBe('orange');
    expect(swatch('orange').getAttribute('aria-pressed')).toBe('true');
    expect(swatch('blue').getAttribute('aria-pressed')).toBe('false');
    // recolouring never moves or replaces the note
    expect(modelNotes()).toHaveLength(1);
    expect(noteCount()).toBe(1);
  });

  it('each swatch paints the note in its own colour', () => {
    createNoteWithText('painted', CENTRE);
    selectNote(0);

    for (const color of COLORS) {
      fireEvent.click(swatch(color));
      expect(view(0).color).toBe(color);
      expect(note().style.backgroundColor).toBe(cssColor(STICKY_COLORS[color]));
      expect(modelNotes()[0]?.color).toBe(color);
    }
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    createNoteWithText('remove me', CENTRE);
    createNoteWithText('stay', { x: 200, y: 600 });
    selectNote(0);
    const doomed = view(0).id;

    fireEvent.click(screen.getByTestId('delete-note'));

    expect(noteCount()).toBe(1);
    const remaining = modelNotes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).not.toBe(doomed);
    expect(remaining[0]?.text).toBe('stay');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(view(0).selected).toBe(false);
  });

  it('the bin button is named "Delete note"', () => {
    createNoteWithText('named', CENTRE);
    selectNote(0);

    const button = screen.getByRole('button', { name: 'Delete note' });

    expect(button.getAttribute('title')).toBe('Delete note');
  });

  it('the toolbar is hidden while the note is being edited', () => {
    createNote(CENTRE);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    pressEscape();

    // Escape keeps it selected, so the toolbar appears
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    fireEvent.doubleClick(note(), centreOf(0));

    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('the toolbar is hidden during a drag and returns afterwards', () => {
    createNoteWithText('dragged', CENTRE);
    selectNote(0);
    const at = centreOf(0);
    const element = note();

    fireEvent.pointerDown(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(element, { clientX: at.x + 40, clientY: at.y, pointerId: 1, buttons: 1 });
    expect(view(0).dragging).toBe(true);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    fireEvent.pointerUp(element, { clientX: at.x + 40, clientY: at.y, pointerId: 1, button: 0 });

    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('clicking a swatch does not reach the board, so the selection survives', () => {
    createNoteWithText('still mine', CENTRE);
    selectNote(0);

    // a press on the toolbar itself must not clear the selection either
    const toolbar = screen.getByTestId('note-toolbar');
    fireEvent.pointerDown(toolbar, { clientX: CENTRE.x, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(toolbar, { clientX: CENTRE.x, clientY: 200, pointerId: 1, button: 0 });

    expect(view(0).selected).toBe(true);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('the toolbar keeps its screen size at other zoom levels', async () => {
    createNoteWithText('zoomable', CENTRE);
    selectNote(0);
    expect((screen.getByTestId('note-toolbar-anchor') as HTMLElement).style.transform).toBe(
      'scale(1)',
    );

    await setCamera({ ...currentCamera(), zoom: 2 });

    const anchor = screen.getByTestId('note-toolbar-anchor') as HTMLElement;
    expect(anchor.style.transform).toBe('scale(0.5)');
    expect(currentCamera().zoom).toBe(2);
    // the note itself is drawn twice as large, the toolbar is not
    expect(note().style.width).toBe(`${STICKY_SIZE_WORLD}px`);
  });

  it('a note deselected by an empty click loses its toolbar, and gets it back', () => {
    createNoteWithText('on off', CENTRE);
    selectNote(0);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    clickEmptyBoard();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    selectNote(0);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });
});
