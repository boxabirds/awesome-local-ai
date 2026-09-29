// text.object (TC-19 to TC-25): rendering, editing, empty removal, sizes, handles, remote delete
// and undo — the real App with a real Y.Doc and the real undo controller.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutText, textMeasurer } from '../../src/client/objects/textLayout';
import { createSticky, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';
import { getTextContent, setTextBox } from '../../src/shared/objects/text';
import { connectedPeers } from '../unit/peer';
import { dispatchKey, initialCamera } from './helpers';
import { renderApp } from './stickyHelpers';
import { docWithText, textEditor, textEl, textOf, textsOf } from './textHelpers';

beforeEach(() => {
  // user-event stalls when setTimeout is faked: only animation frames are.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

let pointerId = 1;
function clickEl(el: Element, init: { shiftKey?: boolean; x?: number; y?: number } = {}) {
  const id = ++pointerId;
  const at = { clientX: init.x ?? 5, clientY: init.y ?? 5, shiftKey: init.shiftKey };
  fireEvent.pointerDown(el, { ...at, button: 0, pointerId: id });
  fireEvent.pointerUp(el, { ...at, button: 0, pointerId: id });
  fireEvent.click(el, at);
}

function drag(el: Element, from: { x: number; y: number }, dx: number, dy: number) {
  const id = ++pointerId;
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0, pointerId: id });
  fireEvent.pointerMove(el, { clientX: from.x + dx, clientY: from.y + dy, pointerId: id });
  nextFrame();
  fireEvent.pointerUp(el, { clientX: from.x + dx, clientY: from.y + dy, button: 0, pointerId: id });
  nextFrame();
}

/** Page position of a world point with the initial camera. */
function toClient(world: { x: number; y: number }) {
  const cam = initialCamera();
  return { x: world.x - cam.x, y: world.y - cam.y };
}

const handles = () =>
  [...document.querySelectorAll<HTMLElement>('[data-handle]')].map((h) => h.dataset.handle);
const sizeButton = (size: string) =>
  screen.getByRole<HTMLButtonElement>('button', { name: new RegExp(`^Text size ${size} `) });
const selectionStatus = () => screen.getByTestId('selection-status').textContent;
const undoButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' });

/** A text whose stored box is already measured (as the creating client leaves it). */
function measuredText(text: string, at = { x: 0, y: 0 }) {
  const setup = docWithText(text, at);
  setTextBox(setup.doc, setup.id, layoutText(text, 'M', 'auto', null, textMeasurer()));
  return setup;
}

describe('text.object rendering', () => {
  it('renders plain text at its stored box, font from the size preset', () => {
    const { doc, id } = measuredText('Went well', { x: 100, y: 50 });
    renderApp(doc);
    const el = textEl(id)!;
    const t = textOf(doc, id)!;
    expect(el.textContent).toBe('Went well');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('50px');
    expect(el.style.width).toBe(`${t.width}px`);
    expect(el.style.height).toBe(`${t.height}px`);
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(el.style.backgroundColor).toBe('');
    // Reachable with Tab and announced by its content.
    expect(el.tabIndex).toBe(0);
    expect(screen.getByRole('group', { name: 'Went well' })).toBe(el);
  });
});

describe('text.object editing', () => {
  it('TC-19 caret at the end; Enter inserts a new line; Escape ends and keeps it selected', async () => {
    const { doc, id } = measuredText('Went');
    const { user } = renderApp(doc);
    fireEvent.doubleClick(textEl(id)!);
    const textarea = textEditor()!;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(4);
    const oneLine = textOf(doc, id)!.height;

    await user.keyboard('{Enter}well');
    expect(textOf(doc, id)!.text).toBe('Went\nwell');
    expect(textOf(doc, id)!.height).toBeCloseTo(2 * oneLine);

    await user.keyboard('{Escape}');
    expect(textEditor()).toBeNull();
    expect(textOf(doc, id)!.text).toBe('Went\nwell');
    expect(textEl(id)!.dataset.selected).toBe('true');
    expect(document.activeElement).toBe(textEl(id));

    // Enter with the single text selected edits it again, caret at the end.
    await user.keyboard('{Enter}');
    expect(textEditor()).not.toBeNull();
    expect(textEditor()!.selectionStart).toBe('Went\nwell'.length);
    expect(textOf(doc, id)!.text).toBe('Went\nwell');
  });

  it('a click elsewhere ends editing and keeps the typed text', async () => {
    const { doc, id } = measuredText('To');
    const { user, viewport } = renderApp(doc);
    fireEvent.doubleClick(textEl(id)!);
    await user.keyboard(' improve');
    fireEvent.pointerDown(viewport, { clientX: 900, clientY: 700, button: 0, pointerId: 50 });
    fireEvent.pointerUp(viewport, { clientX: 900, clientY: 700, button: 0, pointerId: 50 });
    expect(textEditor()).toBeNull();
    expect(textOf(doc, id)!.text).toBe('To improve');
  });

  it('typing beyond TEXT_MAX_CHARS keeps only the first TEXT_MAX_CHARS characters', () => {
    const { doc, id } = measuredText('a'.repeat(TEXT_MAX_CHARS - 1));
    renderApp(doc);
    fireEvent.doubleClick(textEl(id)!);
    fireEvent.change(textEditor()!, { target: { value: `${'a'.repeat(TEXT_MAX_CHARS - 1)}bcd` } });
    expect(textOf(doc, id)!.text).toBe(`${'a'.repeat(TEXT_MAX_CHARS - 1)}b`);
  });

  it('TC-20 Escape with no characters removes the text and clears the selection', async () => {
    const { doc, user, viewport } = renderApp();
    dispatchKey({ key: 't' });
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 60 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 60 });
    expect(textsOf(doc)).toHaveLength(1);
    expect(selectionStatus()).toBe('1 selected');
    await user.keyboard('{Escape}');
    expect(objectsSnapshot(doc)).toHaveLength(0);
    expect(textEditor()).toBeNull();
    expect(selectionStatus()).toBe('');
    expect(document.querySelectorAll('[data-text-id]')).toHaveLength(0);
  });

  it('a new text typed then emptied is removed on a click elsewhere', async () => {
    const { doc, user, viewport } = renderApp();
    dispatchKey({ key: 't' });
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 61 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 61 });
    await user.keyboard('ab{Backspace}{Backspace}');
    fireEvent.pointerDown(viewport, { clientX: 800, clientY: 600, button: 0, pointerId: 62 });
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });
});

describe('text.object toolbar and handles', () => {
  it('TC-21 the text toolbar shows S M L XL with M pressed; XL keeps the top-left', () => {
    const { doc, id } = measuredText('Went well', { x: 40, y: 80 });
    renderApp(doc);
    clickEl(textEl(id)!);
    expect(screen.getByRole('toolbar', { name: 'Text toolbar' })).toBeTruthy();
    const pressed = ['S', 'M', 'L', 'XL'].map((s) => sizeButton(s).getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false', 'false']);
    expect(sizeButton('XL').textContent).toBe('XL');
    const before = textOf(doc, id)!;

    fireEvent.click(sizeButton('XL'));
    const after = textOf(doc, id)!;
    expect(after).toMatchObject({ size: 'XL', x: 40, y: 80 });
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(textEl(id)!.style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(sizeButton('XL').getAttribute('aria-pressed')).toBe('true');
    // One undo step: size and box together.
    fireEvent.click(undoButton());
    expect(textOf(doc, id)).toEqual(before);
  });

  it('the text toolbar Delete removes the text', () => {
    const { doc, id } = measuredText('Went well');
    renderApp(doc);
    clickEl(textEl(id)!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  it('TC-22 a single selected text shows only the left and right handles', () => {
    const { doc, id } = measuredText('Went well today');
    renderApp(doc);
    clickEl(textEl(id)!);
    expect(handles().sort()).toEqual(['e', 'w']);
    expect(screen.queryByRole('button', { name: 'Resize top' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resize bottom' })).toBeNull();

    // Dragging the right handle narrower sets a fixed width and re-measures the height.
    const before = textOf(doc, id)!;
    const handle = screen.getByRole('button', { name: 'Resize right' });
    drag(handle, toClient({ x: before.width, y: before.height / 2 }), -(before.width - 60), 0);
    const after = textOf(doc, id)!;
    expect(after).toMatchObject({ widthMode: 'fixed', width: 60, x: 0, y: 0, size: 'M' });
    expect(after.height).toBeGreaterThan(before.height);

    // Never narrower than TEXT_MIN_WIDTH_WORLD.
    drag(screen.getByRole('button', { name: 'Resize right' }), toClient({ x: 60, y: 10 }), -500, 0);
    expect(textOf(doc, id)!.width).toBe(40);
  });

  it('TC-23 a text + sticky selection shows all handles; resizing moves the text, font unchanged', () => {
    const { doc, id } = measuredText('Went well', { x: 0, y: 0 });
    const note = createSticky(doc, { x: 300, y: 300 }) as string; // top-left (200, 200)
    renderApp(doc);
    clickEl(textEl(id)!);
    clickEl(document.querySelector(`[data-sticky-id="${note}"]`)!, { shiftKey: true });
    expect(handles()).toHaveLength(8);
    const text = textOf(doc, id)!;

    // Box (0,0)–(400,400); drag the top-left handle by (-400,-400) → box doubles around (400,400).
    const handle = screen.getByRole('button', { name: 'Resize top-left' });
    drag(handle, toClient({ x: 0, y: 0 }), -400, -400);
    const moved = textOf(doc, id)!;
    expect(moved.x).toBeCloseTo(-400);
    expect(moved.y).toBeCloseTo(-400);
    expect(moved).toMatchObject({ size: 'M', widthMode: 'auto', width: text.width, height: text.height });
    const sticky = snapshot(doc)[0];
    expect(sticky.width).toBeCloseTo(STICKY_SIZE_WORLD * 2);
  });
});

describe('text.object collaboration and undo', () => {
  it('TC-24 a remote delete while editing ends editing without error or recreation', async () => {
    const { local, remote } = connectedPeers();
    const { id } = docWithText('Went', { x: 0, y: 0 }, local);
    const errors = vi.spyOn(console, 'error');
    const { user } = renderApp(local);
    fireEvent.doubleClick(textEl(id)!);
    await user.keyboard(' we');
    expect(textOf(remote, id)!.text).toBe('Went we');

    act(() => {
      remote.getMap('objects').delete(id);
    });
    expect(textEditor()).toBeNull();
    expect(textEl(id)).toBeNull();
    await user.keyboard('ll{Escape}');
    expect(objectsSnapshot(local)).toHaveLength(0);
    expect(objectsSnapshot(remote)).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('TC-25 typing then Ctrl+Z reverts the text and its stored box in one step', async () => {
    const { doc, id } = measuredText('Went');
    const { user } = renderApp(doc);
    const before = textOf(doc, id)!;
    fireEvent.doubleClick(textEl(id)!);
    await user.keyboard(' well, and quickly');
    const typed = textOf(doc, id)!;
    expect(typed.text).toBe('Went well, and quickly');
    expect(typed.width).toBeGreaterThan(before.width);

    await user.keyboard('{Control>}z{/Control}');
    expect(textOf(doc, id)).toEqual(before);
    expect(textEditor()!.value).toBe('Went');
    expect(getTextContent(doc, id)!.toString()).toBe('Went');
    expect(undoButton().disabled).toBe(true);
  });

  it('a new text: creation and typing are undone together, never leaving an empty text', async () => {
    const { doc, user, viewport } = renderApp();
    dispatchKey({ key: 't' });
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 70 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, button: 0, pointerId: 70 });
    await user.keyboard('Went well{Escape}');
    expect(textsOf(doc).map((t) => t.text)).toEqual(['Went well']);
    fireEvent.click(undoButton());
    expect(objectsSnapshot(doc)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(textsOf(doc).map((t) => t.text)).toEqual(['Went well']);
  });
});
