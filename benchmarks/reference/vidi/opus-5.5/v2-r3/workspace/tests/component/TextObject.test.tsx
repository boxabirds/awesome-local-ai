import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import {
  TEXT_CARET_ALLOWANCE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createText, getTextContent, isText, setTextBox, type TextSnapshot } from '../../src/shared/objects/text';
import { setTextMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import { HEADING_WENT_WELL, PASTE_5001 } from '../fixtures/texts';
import { boardDoc, flushFrame, keyDown, model, noteEl, press, readCamera, renderApp, useFakeFrames } from './helpers';

/** Deterministic fake measurer: every character is half the font size wide. */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
const lineHeight = (px: number) => px * TEXT_LINE_HEIGHT;

beforeEach(() => setTextMeasurer(fake));
afterEach(() => setTextMeasurer(null));

function texts(): TextSnapshot[] {
  return objectsSnapshot(boardDoc()).filter(isText) as TextSnapshot[];
}

function textOf(id: string): TextSnapshot | undefined {
  return texts().find((t) => t.id === id);
}

function textEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
  if (!el) throw new Error(`text ${id} not rendered`);
  return el;
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement;
}

/** Seeds a text object as already-loaded board state (non-local origin, so not in my history). */
function seedText(at: { x: number; y: number }, content: string, author = 'g_someone'): string {
  return model((doc) => {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(scratch);
    const id = createText(scratch, at, author)!;
    getTextContent(scratch, id)!.insert(0, content);
    // The box its author measured (one line at M).
    setTextBox(scratch, id, { width: fake(content, TEXT_SIZES.M) + TEXT_CARET_ALLOWANCE_WORLD, height: lineHeight(TEXT_SIZES.M) });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch, before), 'seed');
    return id;
  });
}

/** Text tool + click at a screen point; returns the new text's id (now being edited). */
function placeText(viewport: HTMLElement, clientX = 300, clientY = 200): string {
  keyDown(document.body, 't');
  fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX, clientY });
  fireEvent.pointerUp(viewport, { pointerId: 1, clientX, clientY });
  const all = texts();
  return all[all.length - 1].id;
}

function ctrlZ(target: EventTarget) {
  const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

describe('text objects: editing (text.object)', () => {
  it('renders plain text with no fill at its stored box, announced by its content', () => {
    renderApp();
    const id = seedText({ x: 40, y: 60 }, HEADING_WENT_WELL);
    const el = textEl(id);
    expect(el).toHaveAccessibleName(HEADING_WENT_WELL);
    expect(el).toHaveAttribute('tabindex', '0');
    expect(el.style.left).toBe('40px');
    expect(el.style.top).toBe('60px');
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(el.style.backgroundColor).toBe('');
    expect(screen.getByTestId('text-content')).toHaveTextContent(HEADING_WENT_WELL);
  });

  it('TC-19 caret at the end on Enter; Enter inserts a newline; Escape ends editing and keeps the text selected', async () => {
    const user = userEvent.setup();
    renderApp();
    const id = seedText({ x: 0, y: 0 }, 'Went');
    press(textEl(id));
    expect(textEl(id).dataset.selected).toBe('true');
    keyDown(textEl(id), 'Enter');
    const ta = editor();
    expect(ta).toHaveFocus();
    expect(ta.value).toBe('Went');
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
    await user.type(ta, ' well{Enter}Pairing');
    expect(textOf(id)!.text).toBe('Went well\nPairing');
    // Box follows the local typing: longest line, two lines tall.
    expect(textOf(id)!.width).toBe(fake('Went well', TEXT_SIZES.M) + TEXT_CARET_ALLOWANCE_WORLD);
    expect(textOf(id)!.height).toBeCloseTo(2 * lineHeight(TEXT_SIZES.M), 9);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(textOf(id)!.text).toBe('Went well\nPairing');
    expect(textEl(id).dataset.selected).toBe('true');
    expect(textEl(id).dataset.editing).toBe('false');
    expect(textEl(id)).toHaveFocus();
  });

  it('TC-19 double-click edits; clicking elsewhere ends editing and keeps the text', async () => {
    const user = userEvent.setup();
    const { viewport } = renderApp();
    const id = seedText({ x: 0, y: 0 }, 'To');
    fireEvent.doubleClick(textEl(id));
    await user.type(editor(), ' improve');
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 900, clientY: 700 });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(textOf(id)!.text).toBe('To improve');
  });

  it('the new text grows as typed and pasting past the limit keeps 5,000 characters', async () => {
    const user = userEvent.setup();
    const { viewport } = renderApp();
    const id = placeText(viewport);
    await user.type(editor(), 'Went');
    const w1 = textOf(id)!.width;
    await user.type(editor(), ' well');
    expect(textOf(id)!.width).toBeGreaterThan(w1);
    await user.clear(editor());
    await user.click(editor());
    await user.paste(PASTE_5001);
    expect(textOf(id)!.text).toHaveLength(TEXT_MAX_CHARS);
    expect(editor().value).toHaveLength(TEXT_MAX_CHARS);
    expect(textOf(id)!.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-20 Escape with no characters removes the new text and clears the selection; no undo step is left', async () => {
    const user = userEvent.setup();
    const { viewport } = renderApp();
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    expect(undoButton).toBeDisabled();
    placeText(viewport);
    expect(texts()).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(texts()).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
    expect(screen.getByTestId('selection-announcer')).toHaveTextContent('');
    expect(undoButton).toBeDisabled();
  });

  it('TC-20 text erased to nothing is removed on edit end; one undo brings back the text', async () => {
    const user = userEvent.setup();
    renderApp();
    const id = seedText({ x: 0, y: 0 }, 'ab');
    fireEvent.doubleClick(textEl(id));
    await user.keyboard('{Backspace}{Backspace}');
    expect(textOf(id)!.text).toBe('');
    await user.keyboard('{Escape}');
    expect(textOf(id)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(textOf(id)!.text).toBe('ab');
  });

  it('a new text and its first typing undo together (never an invisible empty text)', async () => {
    const user = userEvent.setup();
    const { viewport } = renderApp();
    const id = placeText(viewport);
    await user.type(editor(), HEADING_WENT_WELL);
    await user.keyboard('{Escape}');
    expect(textOf(id)!.text).toBe(HEADING_WENT_WELL);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(textOf(id)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(textOf(id)!.text).toBe(HEADING_WENT_WELL);
  });

  it('TC-24 remote delete while editing: editor unmounts, no error, object not recreated', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error');
    renderApp();
    const id = seedText({ x: 0, y: 0 }, 'Went');
    fireEvent.doubleClick(textEl(id));
    await user.type(editor(), ' well');
    model((doc) => {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      const before = Y.encodeStateVector(remote);
      deleteObjects(remote, [id]);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, before), 'remote');
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector(`[data-text-id="${id}"]`)).toBeNull();
    await user.keyboard('x{Escape}');
    expect(textOf(id)).toBeUndefined();
    expect(objectsSnapshot(boardDoc())).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('TC-25 type then Ctrl+Z: text and stored box revert together in one step', async () => {
    const user = userEvent.setup();
    renderApp();
    const id = seedText({ x: 0, y: 0 }, 'Went');
    const before = textOf(id)!;
    fireEvent.doubleClick(textEl(id));
    await user.type(editor(), ' well, really well');
    const typed = textOf(id)!;
    expect(typed.width).toBeGreaterThan(before.width);
    // Inside the editor…
    ctrlZ(editor());
    expect(textOf(id)).toMatchObject({ text: 'Went', width: before.width, height: before.height });
    expect(editor().value).toBe('Went');
    // …and on the board after editing: redo and undo move text and box together.
    await user.keyboard('{Escape}');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(textOf(id)).toMatchObject({ text: typed.text, width: typed.width, height: typed.height });
    ctrlZ(document.body);
    expect(textOf(id)).toMatchObject({ text: 'Went', width: before.width, height: before.height });
  });

  it('a remote text change never makes this client write a box', () => {
    renderApp();
    const id = seedText({ x: 0, y: 0 }, 'Went');
    let local = 0;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') local++;
    };
    boardDoc().on('update', onUpdate);
    model((doc) => {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      const before = Y.encodeStateVector(remote);
      getTextContent(remote, id)!.insert(4, ' well and more');
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, before), 'remote');
    });
    boardDoc().off('update', onUpdate);
    expect(local).toBe(0);
    expect(textOf(id)!.text).toBe('Went well and more');
  });
});

describe('text objects: toolbar and handles (text.object)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  function worldToClient(viewport: HTMLElement, p: { x: number; y: number }) {
    const cam = readCamera(viewport);
    return { clientX: (p.x - cam.x) * cam.zoom, clientY: (p.y - cam.y) * cam.zoom };
  }

  function drag(el: Element, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }) {
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, ...from });
    fireEvent.pointerMove(el, { pointerId: 1, ...to });
    flushFrame();
    fireEvent.pointerUp(el, { pointerId: 1, ...to });
    flushFrame();
  }

  it('TC-21 the text toolbar shows S M L XL with M pressed; XL keeps the top-left and re-measures', () => {
    renderApp();
    const id = seedText({ x: 30, y: 70 }, HEADING_WENT_WELL);
    press(textEl(id));
    const bar = screen.getByRole('toolbar', { name: 'Text' });
    const sizes = screen.getAllByRole('button', { name: /^Size / });
    expect(sizes.map((b) => b.textContent)).toEqual(['S', 'M', 'L', 'XL']);
    expect(sizes.map((b) => b.getAttribute('aria-label'))).toEqual(['Size S', 'Size M', 'Size L', 'Size XL']);
    expect(screen.getByRole('button', { name: 'Size M' })).toHaveAttribute('aria-pressed', 'true');
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Delete text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size XL' }));
    const t = textOf(id)!;
    expect(t).toMatchObject({ size: 'XL', x: 30, y: 70 });
    expect(t.width).toBe(fake(HEADING_WENT_WELL, TEXT_SIZES.XL) + TEXT_CARET_ALLOWANCE_WORLD);
    expect(t.height).toBeCloseTo(lineHeight(TEXT_SIZES.XL), 9);
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute('aria-pressed', 'true');
    // One undo reverts size and box together.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(textOf(id)).toMatchObject({ size: 'M', width: fake(HEADING_WENT_WELL, TEXT_SIZES.M) + TEXT_CARET_ALLOWANCE_WORLD });
    // Delete in the text toolbar removes it.
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(textOf(id)).toBeUndefined();
  });

  it('TC-22 a selected text shows only the left and right handles; dragging the right one fixes the width and rewraps', () => {
    const { viewport } = renderApp();
    const id = seedText({ x: 0, y: 0 }, 'abc de fgh');
    press(textEl(id));
    const labels = screen.getAllByRole('button', { name: /^Resize / }).map((h) => h.getAttribute('aria-label'));
    expect(labels.sort()).toEqual(['Resize left', 'Resize right']);
    const start = textOf(id)!;
    const right = screen.getByRole('button', { name: 'Resize right' });
    const from = worldToClient(viewport, { x: start.width, y: start.height / 2 });
    // Narrower than the minimum: clamps to TEXT_MIN_WIDTH_WORLD, one word per line.
    drag(right, from, { clientX: from.clientX - 500, clientY: from.clientY + 40 });
    const t = textOf(id)!;
    expect(t).toMatchObject({ widthMode: 'fixed', width: TEXT_MIN_WIDTH_WORLD, x: 0, y: 0, size: 'M' });
    expect(t.height).toBeCloseTo(3 * lineHeight(TEXT_SIZES.M), 9);
    // The whole drag is one undo step.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(textOf(id)).toMatchObject({ widthMode: 'auto', width: start.width, height: start.height });
  });

  it('TC-22 dragging the left handle keeps the right edge in place', () => {
    const { viewport } = renderApp();
    const id = seedText({ x: 0, y: 0 }, 'abc de fgh');
    press(textEl(id));
    const start = textOf(id)!;
    const left = screen.getByRole('button', { name: 'Resize left' });
    const from = worldToClient(viewport, { x: 0, y: start.height / 2 });
    drag(left, from, { clientX: from.clientX + 30, clientY: from.clientY });
    const t = textOf(id)!;
    expect(t.widthMode).toBe('fixed');
    expect(t.x + t.width).toBeCloseTo(start.x + start.width, 9);
    expect(t.width).toBeCloseTo(start.width - 30 / readCamera(viewport).zoom, 9);
  });

  it('TC-23 text + sticky selection shows all handles; resizing moves the text proportionally and keeps its size', () => {
    const { viewport } = renderApp();
    const noteId = model((doc) => createSticky(doc, { x: 100, y: 100 })); // 0,0 → 200,200
    const id = seedText({ x: 100, y: 300 }, HEADING_WENT_WELL);
    press(noteEl(noteId));
    fireEvent.pointerDown(textEl(id), { pointerId: 1, button: 0, shiftKey: true, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(textEl(id), { pointerId: 1, shiftKey: true, clientX: 5, clientY: 5 });
    expect(screen.getAllByRole('button', { name: /^Resize / })).toHaveLength(8);
    const start = textOf(id)!;
    const note = snapshot(boardDoc())[0];
    const boxRight = Math.max(note.x + note.width, start.x + start.width);
    const boxBottom = start.y + start.height;
    const from = worldToClient(viewport, { x: boxRight, y: boxBottom });
    const cam = readCamera(viewport);
    drag(screen.getByRole('button', { name: 'Resize bottom-right' }), from, {
      clientX: from.clientX + boxRight * cam.zoom,
      clientY: from.clientY + boxBottom * cam.zoom,
    }); // doubles the box
    const t = textOf(id)!;
    expect(snapshot(boardDoc())[0].width).toBeCloseTo(400, 6);
    expect(t.x).toBeCloseTo(200, 6);
    expect(t.y).toBeCloseTo(600, 6);
    expect(t).toMatchObject({ size: 'M', widthMode: 'auto', width: start.width, height: start.height });
  });
});
