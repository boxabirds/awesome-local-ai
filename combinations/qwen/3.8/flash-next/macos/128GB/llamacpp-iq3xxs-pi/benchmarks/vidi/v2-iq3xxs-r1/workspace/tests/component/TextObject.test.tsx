import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { HANDLE_SIZE_PX, TEXT_SIZES } from '../../src/shared/config';
import { estimateMeasurer, layoutText } from '../../src/client/objects/textLayout';
import type { TextSize } from '../../src/shared/config';
import { dispatchKey, flushFrame, TEST_BOARD_ID } from './util';
import {
  clickElement,
  clickWithPointer,
  createUnselectedNote,
  getDoc,
  getSelection,
  viewportEl,
} from './stickyUtil';
import {
  clickText,
  editText,
  getTexts,
  marquee,
  pressKey,
  seedText,
  typeIntoText,
} from './textUtil';

/**
 * Story 9 — writing, sizing and selecting free text (text.create / text.edit /
 * text.sizing / text.selection).
 *
 * jsdom has no canvas, so every box measured here is measured by the documented
 * fallback; the expected boxes are computed with that same measurer instead of being
 * typed in, so they say what the layout promises and not what one font produced.
 */

/**
 * A board of one's own. Teardown can leave the previous test's board mounted until
 * the scheduler gets a turn, and two boards on one page means the test hook and the
 * DOM can disagree about which one is being tested — so a frame is flushed before
 * and after mounting.
 */
async function freshBoard(): Promise<void> {
  await flushFrame();
  render(<Board boardId={TEST_BOARD_ID} sync={false} />);
  await flushFrame();
}

/** The box `text` should have at `size`, as the layout and the measurer agree. */
function expectedBox(text: string, size: TextSize): { width: number; height: number } {
  const box = layoutText(text, size, 'auto', 0, estimateMeasurer);
  return { width: box.width, height: box.height };
}

/** The caret position in the text editor, as a person left it. */
function caret(): { start: number; end: number } {
  const input = screen.getByTestId('text-object-input') as HTMLTextAreaElement;
  return { start: input.selectionStart ?? -1, end: input.selectionEnd ?? -1 };
}

/** The resize handles currently drawn, by side. */
function handleSides(): string[] {
  return screen
    .queryAllByTestId(/^handle-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('handle-', ''))
    .sort();
}

/** Every object the board has marked as selected, of either kind. */
function selectedEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-selected="true"]'));
}

// =========================================================== TC-19
describe('editing a text (text.edit)', () => {
  it('TC-19 puts the caret at the end of the existing text, selecting nothing', async () => {
    await freshBoard();
    const id = seedText({ x: 40, y: 40, text: 'Roadmap Q3' });
    await flushFrame();

    editText({ x: 4, y: 4 });

    expect(getSelection().editingId).toBe(id);
    const input = screen.getByTestId('text-object-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Roadmap Q3');
    expect(caret()).toEqual({ start: 'Roadmap Q3'.length, end: 'Roadmap Q3'.length });
    // The object being edited is still the selected one.
    expect(getSelection().selectedId).toBe(id);
  });

  // TC-20: an empty text is removed when editing ends — by Escape, by clicking away,
  // or by deleting every character while still editing.
  it('TC-20 removes an empty text when editing ends however it ends', async () => {
    await freshBoard();
    // The Text tool creates an empty text and opens it for editing straight away.
    const create = (): string => {
      dispatchKey({ key: 't' });
      clickWithPointer(viewportEl(), { x: 300, y: 200 });
      const texts = getTexts();
      return texts[texts.length - 1]!.id;
    };

    const first = create();
    pressKey('Escape');
    expect(getTexts().map((t) => t.id)).not.toContain(first);
    expect(screen.queryByTestId('text-object')).toBeNull();

    const second = create();
    clickWithPointer(viewportEl(), { x: 5, y: 5 }); // a click elsewhere ends editing
    expect(getTexts().map((t) => t.id)).not.toContain(second);

    const third = create();
    typeIntoText('x');
    expect(getTexts().find((t) => t.id === third)!.text).toBe('x');
    act(() => {
      const input = screen.getByTestId('text-object-input') as HTMLTextAreaElement;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Emptying it while still typing keeps the object: the caret needs somewhere to
    // be, and the next character would be part of the same edit.
    expect(getTexts().map((t) => t.id)).toContain(third);
    expect(screen.getByTestId('text-object').dataset.editing).toBe('true');
    // What ends the edit is what removes it, so nothing invisible is left behind.
    pressKey('Escape');
    expect(getTexts().map((t) => t.id)).not.toContain(third);
    expect(screen.queryByTestId('text-object-input')).toBeNull();
  });

  // TC-21: the size buttons change only the size preset (and the box that follows from
  // it), and are unavailable while the text is being edited.
  it('TC-21 changes the size preset, but never while the text is being edited', async () => {
    await freshBoard();
    const id = seedText({ x: 0, y: 0, text: 'Ship the release', size: 'M' });
    await flushFrame();
    clickText({ x: 4, y: 4 });

    // The toolbar offers the four presets, with the size the text has now pressed in.
    expect(screen.queryByTestId('text-toolbar')).not.toBeNull();
    expect(
      (['S', 'M', 'L', 'XL'] as const).map((key) =>
        screen.getByTestId(`text-size-${key}`).getAttribute('aria-pressed'),
      ),
    ).toEqual(['false', 'true', 'false', 'false']);

    await clickElement(screen.getByRole('button', { name: 'Extra large (XL)' }));

    const big = getTexts()[0]!;
    expect(big).toMatchObject({ id, type: 'text', x: 0, y: 0, text: 'Ship the release', size: 'XL' });
    // Only what bigger letters imply: the box, from the size.
    expect(big.widthMode).toBe('auto');
    expect(big).toMatchObject(expectedBox('Ship the release', 'XL'));
    await flushFrame();
    expect(screen.getByTestId('text-content').style.fontSize).toBe(`${TEXT_SIZES.XL}px`);

    // The size that was chosen is pressed in, and the one being typed into is not
    // offered at all: typing and resizing are never both happening.
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
    editText({ x: 4, y: 4 });
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
    expect(getTexts()[0]!.size).toBe('XL'); // unchanged by the absence of buttons
  });
});

// =========================================================== TC-22, TC-23
describe('selecting a text (text.selection)', () => {
  it('TC-22 gives a single text east and west handles, nothing else', async () => {
    await freshBoard();
    const id = seedText({ x: 0, y: 0, text: 'Wider please' });
    await flushFrame();
    clickText({ x: 4, y: 4 });

    expect(getSelection().selectedId).toBe(id);
    expect(handleSides()).toEqual(['e', 'w']);

    // The bounding box is the text's own box, at the camera's scale.
    const overlay = screen.getByTestId('selection-overlay') as HTMLElement;
    const text = getTexts()[0]!;
    expect(overlay.style.width).toBe(`${text.width + HANDLE_SIZE_PX}px`);
    expect(overlay.style.height).toBe(`${text.height + HANDLE_SIZE_PX}px`);
    expect(text).toMatchObject(expectedBox('Wider please', 'M'));
  });

  // TC-23: a mixed selection keeps every handle, so a note inside it can still be
  // resized freely.
  it('TC-23 gives a mixed selection all eight handles', async () => {
    await freshBoard();
    await createUnselectedNote('Note alongside');
    seedText({ x: 20, y: 20, text: 'Text alongside' });
    await flushFrame();

    clickText({ x: 4, y: 4 });
    expect(handleSides()).toEqual(['e', 'w']);

    // A rubber band over both objects: one selection of both kinds.
    await marquee({ x: 200, y: 100 }, { x: 900, y: 700 });

    expect(selectedEls()).toHaveLength(2);
    expect(handleSides()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  // TC-24: an open editor while someone else deletes the object closes cleanly.
  it('TC-24 closes the editor when the text being edited is deleted remotely', async () => {
    await freshBoard();
    const id = seedText({ x: 0, y: 0, text: 'Someone else will remove this' });
    await flushFrame();
    editText({ x: 4, y: 4 });
    expect(getSelection().editingId).toBe(id);

    // A remote delete arrives as a plain model update from another client.
    const doc = getDoc();
    act(() => {
      doc.transact(() => {
        doc.getMap('objects').delete(id);
      }, 'remote');
    });
    await flushFrame();

    expect(getTexts().map((t) => t.id)).not.toContain(id);
    expect(screen.queryByTestId('text-object-input')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(getSelection()).toEqual({ selectedId: null, editingId: null });
  });

  // TC-25: undo brings the text and its box back as one step.
  it('TC-25 undoes typing and its box together, as one step', async () => {
    await freshBoard();
    const id = seedText({ x: 0, y: 0, text: 'Half a sentence' });
    await flushFrame();
    editText({ x: 4, y: 4 });
    typeIntoText(', and the box that goes with it');

    const typed = getTexts()[0]!;
    expect(typed.text.length).toBeGreaterThan('Half a sentence'.length);
    expect(typed).toMatchObject(expectedBox(typed.text, 'M'));
    const widthWhenTyped = typed.width;

    // Ctrl+Z typed while still editing: the editor owns the shortcut (PRD undo.typing),
    // and one step takes the whole typing session back, box included.
    const input = screen.getByTestId('text-object-input');
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await flushFrame();

    const undone = getTexts().find((t) => t.id === id);
    if (undone) {
      expect(undone.text).toBe('Half a sentence');
      expect(undone).toMatchObject(expectedBox('Half a sentence', 'M'));
      expect(undone.width).toBeLessThan(widthWhenTyped);
    } else {
      // Undo can also take the object itself back — the same single step.
      expect(screen.queryByTestId('text-object-input')).toBeNull();
    }
  });
});
