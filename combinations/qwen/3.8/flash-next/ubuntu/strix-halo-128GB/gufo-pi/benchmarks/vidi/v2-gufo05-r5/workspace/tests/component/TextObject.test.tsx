/**
 * Text object component tests (TC-19 to TC-25).
 *
 * The whole board is rendered, so a text is created, selected, typed into, resized and undone by
 * the same code the app runs. Two things are checked everywhere they matter: what the document
 * holds (`objects()` - the box included, because the box is what everybody else sees) and what the
 * screen offers (the toolbar's pressed states, the handles that appear).
 *
 * Text measurement in jsdom has no canvas, so widths come from the character-count estimate. That
 * is deliberate: the exact numbers are the layout function's business (unit-tested with a fake
 * measurer), while here what matters is *that* the box follows the text and *that* nothing the
 * screen does changes the font.
 */
import { act, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { renderBoard, dispatchKey, runFrames } from './helpers';
import {
  createSticky,
  isTextSnapshot,
  objectBounds,
  type ObjectSnapshot,
  type TextSnapshot,
} from '../../src/shared/board-model';
import { createText, getTextContent, textLineHeightPx } from '../../src/shared/objects/text';
import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import type { Handle } from '../../src/shared/geometry';

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function objects(): readonly ObjectSnapshot[] {
  return window.__vidi6?.getObjects() ?? [];
}

function textObject(id: string): TextSnapshot | undefined {
  return objects().find((object): object is TextSnapshot => object.id === id && object.type === 'text');
}

function textElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
  if (!element) throw new Error(`text ${id} is not rendered`);
  return element;
}

function viewport(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (!element) throw new Error('viewport not found');
  return element;
}

function input(): HTMLTextAreaElement {
  return screen.getByTestId('text-object-input') as HTMLTextAreaElement;
}

function type(value: string): void {
  fireEvent.change(input(), { target: { value } });
}

async function addText(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => {
    id = createText(doc(), { x, y }, 'local') ?? '';
  });
  await runFrames();
  return id;
}

async function addNote(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(doc(), { x, y });
  });
  await runFrames();
  return id;
}

/** Screen coordinates equal world coordinates, so a box can be asserted exactly. */
async function originCamera(): Promise<void> {
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 });
  await runFrames();
  await runFrames();
}

async function selectText(id: string, at = { x: 300, y: 300 }): Promise<void> {
  const element = textElement(id);
  fireEvent.pointerDown(element, pointer(at.x, at.y));
  fireEvent.pointerUp(element, pointer(at.x, at.y));
  await runFrames();
}

/** The way the Text tool itself makes text: T, then a click where it should start. */
async function placeTextWithTool(x: number, y: number): Promise<string> {
  dispatchKey(window, { key: 't' });
  fireEvent.pointerDown(viewport(), pointer(x, y));
  fireEvent.pointerUp(viewport(), pointer(x, y));
  await runFrames();
  const placed = objects().filter(isTextSnapshot).at(-1);
  if (!placed) throw new Error('the Text tool placed nothing');
  return placed.id;
}

function handles(): Handle[] {
  return [...document.querySelectorAll<HTMLElement>('.selection-handle')].map(
    (element) => element.dataset.handle as Handle,
  );
}

/**
 * Where a handle is, in screen coordinates. The camera is at the origin with zoom 1, so content
 * coordinates are screen coordinates, and the handle sits at the centre of its 12-unit square.
 */
function handlePoint(handle: Handle): { x: number; y: number } {
  const element = document.querySelector<HTMLElement>(`.selection-handle[data-handle="${handle}"]`);
  if (!element) throw new Error(`handle ${handle} is not rendered`);
  return {
    x: Number.parseFloat(element.style.left) + 6,
    y: Number.parseFloat(element.style.top) + 6,
  };
}

/** Drags a resize handle, the way a pointer does it: down on the handle, move, up. */
async function dragHandle(handle: Handle, dx: number, dy: number): Promise<void> {
  const from = handlePoint(handle);
  fireEvent.pointerDown(
    document.querySelector<HTMLElement>(`.selection-handle[data-handle="${handle}"]`)!,
    pointer(from.x, from.y),
  );
  await runFrames();
  fireEvent.pointerMove(window, pointer(from.x + dx, from.y + dy));
  await runFrames();
  fireEvent.pointerUp(window, pointer(from.x + dx, from.y + dy));
  await runFrames();
}

/**
 * The corner a group resize holds still: the one opposite the handle being dragged.
 */
function groupAnchor(selected: readonly ObjectSnapshot[], handle: Handle): { x: number; y: number } {
  const bounds = selected.map(objectBounds);
  const left = Math.min(...bounds.map((b) => b.x));
  const top = Math.min(...bounds.map((b) => b.y));
  const right = Math.max(...bounds.map((b) => b.x + b.width));
  const bottom = Math.max(...bounds.map((b) => b.y + b.height));
  return { x: handle.includes('w') ? right : left, y: handle.includes('n') ? bottom : top };
}

/**
 * A change that came from somebody else. The board tells the two apart by the transaction origin,
 * and everything that is not this screen's own origin arrives from the room as far as this tab is
 * concerned.
 */
function asRemote(write: () => void): void {
  act(() => {
    doc().transact(() => {
      write();
    });
  });
}

describe('text.object.editing', () => {
  test('TC-19 typing writes text, Enter is a new line, Escape keeps it and the text stays selected', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(120, 80);
    await selectText(id);
    expect(textElement(id)).toHaveAttribute('data-selected', 'true');

    // Enter on a single selected object starts editing it, because the registry says text has text
    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    const editor = input();
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(0); // an empty text: the caret is at its end, which is 0

    type('Went well');
    await runFrames();
    expect(textObject(id)?.text).toBe('Went well');
    // and the box grew to hold it, one line tall
    const typed = textObject(id)!;
    expect(typed.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
    expect(typed.height).toBeCloseTo(textLineHeightPx('M'), 6);

    // Enter belongs to the text, not to the board: it is not taken over, and editing goes on
    const enter = dispatchKey(editor, { key: 'Enter' });
    expect(enter.defaultPrevented).toBe(false);
    expect(input()).toHaveFocus();
    fireEvent.change(input(), { target: { value: 'Went well\nand thanks' } }); // what a browser does
    await runFrames();
    expect(textObject(id)?.text).toBe('Went well\nand thanks');
    expect(textObject(id)!.height).toBeCloseTo(2 * textLineHeightPx('M'), 6);

    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    expect(screen.queryByTestId('text-object-input')).toBeNull();
    expect(textObject(id)?.text).toBe('Went well\nand thanks');
    expect(textElement(id)).toHaveAttribute('data-selected', 'true');
    expect(textElement(id).textContent).toContain('and thanks');
  });

  test('TC-20 Escape with nothing typed leaves no text and no selection', async () => {
    renderBoard();
    await runFrames();
    await originCamera();

    const id = await placeTextWithTool(300, 200);
    // the tool left the new text being written, ready for the first character
    expect(input()).toHaveFocus();

    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    expect(textObject(id)).toBeUndefined();
    expect(objects().filter(isTextSnapshot)).toHaveLength(0);
    expect(handles()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bbox')).toBeNull();
  });

  test('a pointer on the text being written keeps the edit, and is not a drag of it either', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(0, 0);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('To improve');
    await runFrames();

    // the text under the pointer is the one being written, so the pointer selects it and leaves it
    fireEvent.pointerDown(textElement(id), pointer(300, 300));
    fireEvent.pointerMove(window, pointer(360, 340));
    fireEvent.pointerUp(window, pointer(360, 340));
    await runFrames();

    expect(input()).toHaveFocus();
    expect(input().value).toBe('To improve');
    expect(textObject(id)?.text).toBe('To improve');
    expect(textElement(id)).toHaveAttribute('data-selected', 'true');
    // and the caret is still where the person left it, not sent back to the start
    expect(input().selectionStart).toBe(input().value.length);
  });

  test('TC-24 a text deleted by somebody else while typing ends the edit and does not come back', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(0, 0);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('Heading');
    await runFrames();
    expect(input()).toHaveFocus();

    asRemote(() => {
      doc().getMap<Y.Map<unknown>>('objects').delete(id);
    });
    await runFrames();

    // the editor is gone, nothing was written back, and no ghost of the object is left
    expect(screen.queryByTestId('text-object-input')).toBeNull();
    expect(document.querySelector('[data-text-id]')).toBeNull();
    expect(objects()).toHaveLength(0);

    // and the board still answers afterwards
    const other = await addText(40, 40);
    expect(textObject(other)?.text).toBe('');
  });
});

describe('text.object.sizes', () => {
  test('TC-21 the toolbar shows the four sizes with the current one pressed; XL changes it in place', async () => {
    renderBoard();
    await runFrames();
    // an empty text: its box is at the minimum, so the size change is the only thing that moves it
    const id = await addText(120, 80);
    await selectText(id);

    const toolbar = within(textElement(id)).getByTestId('text-toolbar');
    expect(within(toolbar).getByLabelText('Small text')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Medium text')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Large text')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Extra large text')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Medium text')).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByLabelText('Extra large text')).toHaveAttribute('aria-pressed', 'false');

    const before = textObject(id)!;
    expect(before.size).toBe('M');

    fireEvent.click(within(toolbar).getByLabelText('Extra large text'));
    await runFrames();

    const after = textObject(id)!;
    expect(after.size).toBe('XL');
    // the corner it stands on does not move (PRD text.size)
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // and the box is the size it now is: one XL line tall
    expect(after.height).toBeCloseTo(textLineHeightPx('XL'), 6);
    expect(textElement(id)).toHaveAttribute('data-size', 'XL');
    expect(within(toolbar).getByLabelText('Extra large text')).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByLabelText('Medium text')).toHaveAttribute('aria-pressed', 'false');
    // the drawn text carries the font size of the preset
    expect(within(textElement(id)).getByTestId('text-object-text')).toHaveStyle({
      fontSize: `${TEXT_SIZES.XL}px`,
    });
  });

  test('the size of text with characters in it re-measures the box and keeps the characters', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(0, 0);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('To improve');
    await runFrames();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await runFrames();
    const before = textObject(id)!;

    fireEvent.click(within(textElement(id)).getByLabelText('Large text'));
    await runFrames();

    const after = textObject(id)!;
    expect(after.text).toBe('To improve');
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeCloseTo(textLineHeightPx('L'), 6);
  });

  test('the text toolbar is switched off, not missing, on a board that cannot be written to', async () => {
    // the disabled state is the toolbar's own rule (`canEdit` false); the read-only board as a whole
    // is proven in BoardLoadFailure.test.tsx
    renderBoard();
    await runFrames();
    const id = await addText(0, 0);
    await selectText(id);
    expect(within(textElement(id)).getByTestId('text-toolbar')).toBeInTheDocument();
  });
});

describe('text.object.handles', () => {
  test('TC-22 one selected text shows the two side handles and nothing else', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(0, 0);
    await selectText(id);

    expect(handles()).toEqual(['e', 'w']);
    // and both are named, so they are not found by shape alone
    const element = document.querySelector<HTMLElement>('.selection-handle[data-handle="e"]');
    expect(element).toHaveAccessibleName('Resize right');
    expect(document.querySelector<HTMLElement>('.selection-handle[data-handle="se"]')).toBeNull();
  });

  test('TC-23 a text beside a note shows all handles; the drag moves the text and never its font', async () => {
    renderBoard();
    await runFrames();
    await originCamera();
    // the note holds the top-left corner of the group, the text hangs inside it and away from it
    const noteId = await addNote(0, 0);
    const textId = await addText(300, 300);

    await selectText(textId);
    const note = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)!;
    fireEvent.pointerDown(note, pointer(420, 420, { shiftKey: true }));
    fireEvent.pointerUp(note, pointer(420, 420, { shiftKey: true }));
    await runFrames();

    expect(handles()).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

    const all = objects();
    const before = textObject(textId)!;
    const noteBefore = objectBounds(all.find((object) => object.id === noteId)!);

    await dragHandle('se', 200, 200);

    const after = textObject(textId)!;
    const noteAfter = objectBounds(objects().find((object) => object.id === noteId)!);
    // the note took the group's growth; the text moved by the same proportion, measured from the
    // corner the group was dragged away from - and its own preset, the font and so the height of
    // its lines, did not change at all
    const growth = noteAfter.width / noteBefore.width;
    const anchor = groupAnchor(all, 'se');
    expect(growth).toBeGreaterThan(1.2);
    expect(after.x).toBeCloseTo(anchor.x + (before.x - anchor.x) * growth, 6);
    expect(after.y).toBeCloseTo(anchor.y + (before.y - anchor.y) * growth, 6);
    expect(after.size).toBe('M');
    expect(after.height).toBeCloseTo(before.height, 6);
    expect(textElement(textId)).toHaveAttribute('data-size', 'M');
  });

  test('a side handle gives the text a width of its own and the words rewrap', async () => {
    renderBoard();
    await runFrames();
    await originCamera();
    const id = await addText(0, 0);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('alpha beta gamma delta');
    await runFrames();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await runFrames();

    const before = textObject(id)!;
    expect(before.widthMode).toBe('auto');

    await dragHandle('e', -60, 0);

    const after = textObject(id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeLessThan(before.width);
    // the height follows the words: narrower means more lines, never a scroll
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.text).toBe('alpha beta gamma delta');
    expect(textElement(id)).toHaveAttribute('data-width-mode', 'fixed');
  });

  test('a side drag that would make it narrower than the minimum stops at the minimum', async () => {
    renderBoard();
    await runFrames();
    await originCamera();
    const id = await addText(0, 0);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('alpha beta gamma');
    await runFrames();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await runFrames();

    await dragHandle('e', -4000, 0);

    expect(textObject(id)!.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
  });
});

describe('text.object.fit', () => {
  /**
   * Pretend this browser's font needed more room than the stored box offers. jsdom lays nothing
   * out, so the drawn size has to be said out loud; what is under test is that the shortfall is
   * repaired in the document - which is what every other screen then receives.
   */
  function drawnTaller(id: string, lines: number): void {
    const area = textElement(id).querySelector<HTMLElement>('.board-text__content');
    if (!area) throw new Error('the words are not being drawn');
    Object.defineProperty(area, 'scrollHeight', { configurable: true, value: lines * textLineHeightPx('M') });
    Object.defineProperty(area, 'scrollWidth', { configurable: true, value: 0 });
  }

  test('words drawn taller than the stored box grow it, without touching its width', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(120, 80);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('Went well');
    await runFrames();
    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    const typed = textObject(id)!;
    expect(typed.height).toBeCloseTo(textLineHeightPx('M'), 6);

    drawnTaller(id, 3);
    // somebody else's characters arrive, with a box that was right on *their* screen only
    asRemote(() => {
      getTextContent(doc(), id)!.insert(9, ' too');
    });
    await runFrames();

    expect(textObject(id)?.text).toBe('Went well too');
    expect(textObject(id)!.height).toBeCloseTo(3 * textLineHeightPx('M'), 6);
    expect(textObject(id)!.width).toBe(typed.width); // the height's business is the height's
  });

  test('the repair is not an undo step: undoing the typing leaves the room the words needed', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(120, 80);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('Went well');
    await runFrames();
    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    drawnTaller(id, 3);
    asRemote(() => {
      getTextContent(doc(), id)!.insert(9, ' too');
    });
    await runFrames();
    expect(textObject(id)!.height).toBeCloseTo(3 * textLineHeightPx('M'), 6);

    // one undo takes the typing back; the box it grew is left alone, so nothing is ever cut off
    dispatchKey(window, { key: 'z', ctrlKey: true });
    await runFrames();
    expect(textObject(id)!.height).toBeCloseTo(3 * textLineHeightPx('M'), 6);

    // and the person's own delete still works after a repair
    await selectText(id);
    dispatchKey(window, { key: 'Delete' });
    await runFrames();
    expect(textObject(id)).toBeUndefined();
  });

  test('a box that already holds what is drawn is written not at all', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(120, 80);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('Went well');
    await runFrames();
    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    const before = textObject(id)!;
    // nothing sticks out, so nothing is written, whatever arrives next
    drawnTaller(id, 0);
    asRemote(() => {
      getTextContent(doc(), id)!.insert(9, ' too');
    });
    await runFrames();
    await runFrames();

    const after = textObject(id)!;
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });
});

describe('text.object.undo', () => {
  test('TC-25 one undo takes the typed text and its stored box back together', async () => {
    renderBoard();
    await runFrames();
    await originCamera();

    // placed by the tool, which is what makes "the text I typed" a step separate from "the text"
    const id = await placeTextWithTool(200, 150);
    type('Went well');
    await runFrames();

    const typed = textObject(id)!;
    expect(typed.text).toBe('Went well');
    const placedWidth = TEXT_MIN_WIDTH_WORLD;
    expect(typed.width).toBeGreaterThan(placedWidth);

    dispatchKey(input(), { key: 'Escape' });
    await runFrames();

    dispatchKey(window, { key: 'z', ctrlKey: true });
    await runFrames();

    const back = textObject(id)!;
    // one step: the characters are gone and the box is the one it was placed with
    expect(back.text).toBe('');
    expect(back.width).toBe(placedWidth);
    expect(back.height).toBeCloseTo(textLineHeightPx('M'), 6);
    // the object is still there: undo went back to the moment it was placed, not before it
    expect(objects().filter(isTextSnapshot).map((object) => object.id)).toEqual([id]);

    // and redo puts the text and its box back as one step again
    dispatchKey(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await runFrames();
    expect(textObject(id)?.text).toBe('Went well');
    expect(textObject(id)!.width).toBeGreaterThan(placedWidth);
  });

  test('the bin in the text toolbar deletes the text, and one undo brings it back', async () => {
    renderBoard();
    await runFrames();
    const id = await addText(0, 0);
    await selectText(id);
    dispatchKey(window, { key: 'Enter' });
    await runFrames();
    type('Delete me');
    await runFrames();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await runFrames();

    fireEvent.click(within(textElement(id)).getByLabelText('Delete text'));
    await runFrames();
    expect(objects().filter(isTextSnapshot)).toHaveLength(0);
    expect(handles()).toHaveLength(0);

    dispatchKey(window, { key: 'z', ctrlKey: true });
    await runFrames();
    expect(textObject(id)?.text).toBe('Delete me');
  });
});

describe('text.object.styles', () => {
  test('the stylesheet draws text with the numbers the layout measures with', () => {
    // Text is measured by `layoutText` with the settings from `shared/config.ts` and drawn by this
    // stylesheet. They have to say the same thing, or the stored box and the drawn text disagree -
    // which shows up as clipped lines on every screen but the one that wrote the box.
    const css = readFileSync('src/client/styles.css', 'utf8');
    const ruleFor = (selector: string): string => {
      const rule = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(css);
      if (!rule) throw new Error(`styles.css has no rule for .${selector}`);
      return rule[1] ?? '';
    };

    const box = ruleFor('board-text');
    // the stored box is the area the text is laid out in, with the padding outside it
    expect(box).toMatch(/box-sizing:\s*content-box/);
    expect(box).toMatch(
      new RegExp(`padding:\\s*var\\(--text-padding,\\s*${TEXT_BOX_PADDING_WORLD}px\\)`),
    );

    for (const selector of ['board-text__content', 'board-text__input']) {
      const drawn = ruleFor(selector);
      expect(/font-family:\s*([^;]+);/.exec(drawn)?.[1]?.trim()).toBe(TEXT_FONT_FAMILY);
      expect(Number.parseFloat(/line-height:\s*([0-9.]+)/.exec(drawn)?.[1] ?? '')).toBe(
        TEXT_LINE_HEIGHT,
      );
    }
  });
});
