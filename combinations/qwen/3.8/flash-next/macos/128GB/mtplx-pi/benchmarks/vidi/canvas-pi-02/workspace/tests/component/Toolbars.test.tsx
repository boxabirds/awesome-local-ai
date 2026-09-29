import { describe, expect, it } from 'vitest';
import { dispatch, pointerEvent } from './harness';
import { renderApp } from './appHarness';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/**
 * TC-27 to TC-29 - the two toolbars.
 *
 * The colour test also carries a non-functional requirement: the six swatches
 * are named, not just coloured, so the toolbar is usable without colour vision.
 */

async function selectedNote(text = 'Faster onboarding') {
  const harness = renderApp([{ x: 300, y: 200, text }]);
  const id = harness.notes()[0].id;
  const note = harness.noteElement(id);
  await dispatch(note, pointerEvent('pointerdown', { clientX: 400, clientY: 250 }));
  await dispatch(note, pointerEvent('pointerup', { clientX: 400, clientY: 250 }));
  return { harness, id, note };
}

const click = (element: Element) =>
  dispatch(element, new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('note toolbar (TC-27, TC-29)', () => {
  it('shows six named colour swatches and a bin for the selected note', async () => {
    const { harness } = await selectedNote();
    const toolbar = harness.toolbar();
    expect(toolbar).not.toBeNull();

    const swatches = Array.from(
      toolbar?.querySelectorAll<HTMLButtonElement>('[data-testid="note-swatch"]') ?? [],
    );
    expect(swatches).toHaveLength(6);
    expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([
      'Yellow colour',
      'Orange colour',
      'Green colour',
      'Blue colour',
      'Pink colour',
      'Violet colour',
    ]);
    // Names, tooltips and a pressed state: the choice is not colour-only.
    for (const swatch of swatches) {
      expect(swatch.getAttribute('title')).toBe(swatch.getAttribute('aria-label'));
    }
    const current = swatches.filter((swatch) => swatch.getAttribute('aria-pressed') === 'true');
    expect(current.map((swatch) => swatch.dataset.color)).toEqual(['yellow']);
    expect(harness.toolbar()?.querySelector('[aria-label="Delete note"]')).not.toBeNull();
  });

  it('TC-27 clicking a swatch recolours the note and keeps it selected', async () => {
    const { harness, id } = await selectedNote();
    const pink = harness
      .toolbar()!
      .querySelector<HTMLElement>('[data-color="pink"]') as HTMLElement;

    // A real press on the swatch: down and up inside the toolbar, then the
    // click. None of it may reach the viewport, which would clear the
    // selection out from under the toolbar.
    await dispatch(pink, pointerEvent('pointerdown', { clientX: 410, clientY: 190 }));
    await dispatch(pink, pointerEvent('pointerup', { clientX: 410, clientY: 190 }));
    await click(pink);

    expect(harness.notes()[0].color).toBe('pink' satisfies StickyColor);
    expect(harness.noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(harness.toolbar()).not.toBeNull();
    expect(harness.camera()).toEqual({
      x: -window.innerWidth / 2,
      y: -window.innerHeight / 2,
      zoom: 1,
    });
  });

  it('the swatch of the current colour is the pressed one after a recolour', async () => {
    const { harness } = await selectedNote();
    await click(harness.toolbar()!.querySelector<HTMLElement>('[data-color="violet"]') as Element);

    const pressed = Array.from(
      harness.toolbar()?.querySelectorAll<HTMLElement>('[aria-pressed="true"]') ?? [],
    );
    expect(pressed.map((element) => element.dataset.color)).toEqual(['violet']);
  });

  it('TC-29 the bin deletes the note and clears the selection', async () => {
    const { harness } = await selectedNote();
    const bin = harness.toolbar()?.querySelector<HTMLElement>(
      '[aria-label="Delete note"]',
    ) as HTMLElement;

    await click(bin);

    expect(harness.notes()).toHaveLength(0);
    expect(harness.noteElements()).toHaveLength(0);
    expect(harness.toolbar()).toBeNull();
    // The other tools are untouched.
    expect(harness.button('Sticky note')).toBeInstanceOf(HTMLButtonElement);
  });

  it('every colour can be picked, and each one writes to the model', async () => {
    const { harness } = await selectedNote();

    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      const swatch = harness.toolbar()?.querySelector<HTMLElement>(`[data-color="${color}"]`);
      expect(swatch, `no swatch for ${color}`).not.toBeUndefined();

      await click(swatch as HTMLElement);

      expect(harness.notes()[0].color).toBe(color);
      expect(harness.notes()[0].text).toBe('Faster onboarding');
    }
  });
});

describe('left toolbar (TC-28)', () => {
  it('holds a sticky note tool named after the tool, not the shortcut', () => {
    const harness = renderApp();
    const button = harness.button('Sticky note');

    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
    // It is chrome, not board content: no board-object marker, so clicks on it
    // cannot be mistaken for clicks on the board.
    expect(button.closest('[data-board-object]')).toBeNull();
    expect(harness.world().contains(button)).toBe(false);
  });

  it('TC-28 clicking it creates one note in edit mode, wherever the board is', async () => {
    const harness = renderApp();

    await click(harness.button('Sticky note'));

    expect(harness.notes()).toHaveLength(1);
    expect(harness.editor()).not.toBeNull();
  });

  it('TC-34 with the board panned a million units out it still makes a visible note', async () => {
    const harness = renderApp();
    await dispatch(harness.board(), pointerEvent('pointerdown', { clientX: 600, clientY: 400 }));
    await dispatch(harness.board(), pointerEvent('pointermove', { clientX: 100, clientY: 100 }));
    await dispatch(harness.board(), pointerEvent('pointerup', { clientX: 100, clientY: 100 }));
    const panned = harness.camera();
    expect(panned.x).not.toBe(-window.innerWidth / 2);

    await click(harness.button('Sticky note'));

    const note = harness.notes()[0];
    // The note sits in the middle of what is on screen, not at the world origin.
    expect(note.x).toBeGreaterThan(panned.x);
    expect(note.x).toBeLessThan(panned.x + window.innerWidth);
    expect(harness.editor()).not.toBeNull();
  });

  it('creates a new note next to existing ones instead of editing one', async () => {
    const harness = renderApp([{ x: 300, y: 200 }]);

    await click(harness.button('Sticky note'));

    expect(harness.notes()).toHaveLength(2);
    expect(harness.notes()[1].text).toBe('');
    expect(harness.editor()).not.toBeNull();
  });
});
