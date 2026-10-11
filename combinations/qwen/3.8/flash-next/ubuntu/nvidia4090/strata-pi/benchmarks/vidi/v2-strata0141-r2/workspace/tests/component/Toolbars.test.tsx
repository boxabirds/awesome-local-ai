import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import { getStickyText } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { AppHarnessResult } from './appHarness';
import {
  addNote,
  click,
  doubleClick,
  mutate,
  moveTo,
  press,
  release,
  renderApp,
  typeText,
  TEST_VIEWPORT,
} from './appHarness';

/**
 * sticky.toolbar component tests (TC-27, TC-28, TC-29).
 */

const HALF = STICKY_SIZE_WORLD / 2;

async function select(h: AppHarnessResult, id: string): Promise<HTMLElement> {
  const note = h.note(id);
  await press(note, { x: 300, y: 300 });
  await release(note, { x: 300, y: 300 });
  return note;
}

describe('board toolbar and note toolbar', () => {
  it('the Sticky note button carries the documented label and tooltip', async () => {
    const h = await renderApp();
    const button = h.stickyButton();
    expect(button.getAttribute('aria-label')).toBe('Sticky note');
    expect(button.getAttribute('title')).toBe('Sticky note \u2013 or double-click the board');
    expect(h.view.getByTestId('board-toolbar')).toBeDefined();
  });

  // TC-28
  it('TC-28: the Sticky note button creates one note centred on the viewport and starts editing', async () => {
    const h = await renderApp();

    await click(h.stickyButton());

    const snapshots = h.snapshots();
    expect(snapshots).toHaveLength(1);
    const note = snapshots[0];
    // The middle of the screen, wherever the board is panned to.
    const centre = screenToWorld(h.camera(), { x: TEST_VIEWPORT.width / 2, y: TEST_VIEWPORT.height / 2 });
    expect(note).toBeDefined();
    expect(note?.x).toBeCloseTo(centre.x - HALF, 6);
    expect(note?.y).toBeCloseTo(centre.y - HALF, 6);
    expect(note?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note?.text).toBe('');

    const el = h.note(note?.id ?? '');
    expect(el.getAttribute('data-editing')).toBe('true');
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(h.textarea(el)).not.toBeNull();
    expect(h.viewport().getAttribute('data-panning')).toBe('false');
  });

  it('a toolbar-created note survives typing and stays a single note', async () => {
    const h = await renderApp();
    await click(h.stickyButton());
    const id = h.snapshots()[0]?.id ?? '';
    const area = h.textarea(h.note(id));
    if (area) {
      await typeText(area, 'from the toolbar');
    }

    expect(h.snapshots()).toHaveLength(1);
    expect(h.byId(id)?.text).toBe('from the toolbar');
  });

  it('double-clicking empty board space creates a note at the clicked world point', async () => {
    const h = await renderApp();

    await doubleClick(h.viewport(), { x: 400, y: 300 });

    const snapshots = h.snapshots();
    expect(snapshots).toHaveLength(1);
    const note = snapshots[0];
    const clicked = screenToWorld(h.camera(), { x: 400, y: 300 });
    expect(note?.x).toBeCloseTo(clicked.x - HALF, 6);
    expect(note?.y).toBeCloseTo(clicked.y - HALF, 6);
    expect(h.note(note?.id ?? '').getAttribute('data-editing')).toBe('true');
  });

  it('double-clicking the board once creates exactly one note', async () => {
    const h = await renderApp();
    await doubleClick(h.viewport(), { x: 400, y: 300 });
    expect(h.notes()).toHaveLength(1);
    expect(h.snapshots()).toHaveLength(1);
  });

  // TC-27
  it('TC-27: the Pink swatch recolours the note and keeps text, position, z and selection', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 40, 60);
    await mutateText(h, id, 'theme: onboarding');
    const note = await select(h, id);
    const before = h.byId(id);

    const pink = h.view.getByTestId('swatch-pink') as HTMLButtonElement;
    await click(pink);

    const after = h.byId(id);
    expect(after?.color).toBe('pink');
    expect(after?.text).toBe(before?.text);
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z);
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-color')).toBe('pink');
    expect(h.noteToolbar(note)).not.toBeNull();
    expect(pink.getAttribute('aria-pressed')).toBe('true');
  });

  it('every swatch is labelled, pressed on the current colour, and applies its colour', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = await select(h, id);
    const names = Object.keys(STICKY_COLORS) as StickyColor[];
    expect(names).toHaveLength(6);

    for (const name of names) {
      const swatch = h.view.getByTestId(`swatch-${name}`) as HTMLButtonElement;
      const label = `${name.charAt(0).toUpperCase()}${name.slice(1)} colour`;
      expect(swatch.getAttribute('aria-label')).toBe(label);
      expect(swatch.getAttribute('aria-pressed')).toBe(name === DEFAULT_STICKY_COLOR ? 'true' : 'false');
      await click(swatch);
      expect(h.byId(id)?.color).toBe(name);
      expect(swatch.getAttribute('aria-pressed')).toBe('true');
      const pressed = names.filter(
        (other) => (h.view.getByTestId(`swatch-${other}`) as HTMLButtonElement).getAttribute('aria-pressed') === 'true',
      );
      expect(pressed).toEqual([name]);
    }

    expect(note.getAttribute('data-selected')).toBe('true');
  });

  // TC-29
  it('TC-29: the bin button deletes the note and clears the selection', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const other = await addNote(h.doc, 500, 0);
    const note = await select(h, id);

    await click(h.view.getByTestId('delete-note') as HTMLButtonElement);

    expect(h.notes()).toHaveLength(1);
    expect(h.byId(id)).toBeUndefined();
    expect(h.byId(other)?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(h.noteToolbar(h.note(other))).toBeNull();
    expect(note.isConnected).toBe(false);
  });

  it('clicking a note toolbar does not clear the selection or pan the board', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = await select(h, id);
    const cameraBefore = h.camera();

    const toolbar = h.noteToolbar(note);
    expect(toolbar).not.toBeNull();
    if (toolbar) {
      await press(toolbar, { x: 300, y: 120 });
      await release(toolbar, { x: 300, y: 120 });
    }

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(h.camera()).toEqual(cameraBefore);
  });

  it('double-clicking a swatch does not open the editor', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = await select(h, id);
    const toolbar = h.noteToolbar(note);
    expect(toolbar).not.toBeNull();
    if (toolbar) {
      await doubleClick(toolbar, { x: 300, y: 120 });
    }
    expect(note.getAttribute('data-editing')).toBe('false');
    expect(h.textarea()).toBeNull();
  });

  it('the note toolbar is hidden while the note is dragged', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = await select(h, id);
    expect(h.noteToolbar(note)).not.toBeNull();

    await press(note, { x: 300, y: 300 });
    await moveToDrag(h, note, 30);
    expect(h.noteToolbar(note)).toBeNull();
    await release(note, { x: 330, y: 300 });
    await h.flushFrames();
    expect(h.noteToolbar(note)).not.toBeNull();
  });

  it('the toolbar counter-scales so zoom does not grow it', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    await h.flushFrames();
    await select(h, id);
    const anchor = h.view.getByTestId('note-toolbar-anchor');
    expect(anchor.style.transform).toBe('scale(1)');

    await click(h.view.getByTestId('zoom-in'));
    await h.flushFrames();
    const zoom = h.camera().zoom;
    expect(zoom).toBeCloseTo(1.25, 6);
    expect(h.view.getByTestId('note-toolbar-anchor').style.transform).toBe(`scale(${1 / zoom})`);
  });
});

async function mutateText(h: AppHarnessResult, id: string, text: string): Promise<void> {
  await mutate(() => {
    getStickyText(h.doc, id)?.insert(0, text);
  });
}

async function moveToDrag(h: AppHarnessResult, el: HTMLElement, dx: number): Promise<void> {
  await moveTo(el, { x: 300 + dx, y: 300 });
  await h.flushFrames();
}
