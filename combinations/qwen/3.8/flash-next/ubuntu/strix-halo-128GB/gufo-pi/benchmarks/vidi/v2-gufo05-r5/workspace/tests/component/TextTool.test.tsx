/**
 * The Text tool in jsdom (TC-14, TC-16, TC-17, TC-18): the tool keys, the toolbar's two tool
 * buttons, and what a click on the board means while the Text tool is up.
 *
 * The board is rendered for real - the real document, camera, selection and keyboard - and the
 * claims are read from the document and from the buttons' own `aria-pressed`, because "the tool
 * changed" is only visible in what the next click does.
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, getCamera, runFrames } from './helpers';
import { createSticky, isStickySnapshot, isTextSnapshot } from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';

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

function objects() {
  return window.__vidi6?.getObjects() ?? [];
}

function viewport(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (!element) throw new Error('viewport not found');
  return element;
}

function noteElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
}

async function addNote(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(doc(), { x, y });
  });
  await runFrames();
  return id;
}

/** Screen coordinates equal world coordinates, so a click can be asserted exactly. */
async function originCamera(): Promise<void> {
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 });
  await runFrames();
  await runFrames();
}

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const textButton = () => screen.getByRole('button', { name: 'Text (T)' });

describe('text.tool.keys', () => {
  test('TC-14 T picks up the Text tool; Escape and V put it down', async () => {
    renderBoard();
    await runFrames();

    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport()).toHaveAttribute('data-tool', 'select');

    dispatchKey(window, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport()).toHaveAttribute('data-tool', 'text');

    dispatchKey(window, { key: 'Escape' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(viewport()).toHaveAttribute('data-tool', 'select');

    dispatchKey(window, { key: 't' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    dispatchKey(window, { key: 'v' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    // the toolbar buttons do exactly what the keys do
    fireEvent.click(textButton());
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(selectButton());
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-16 T while a note is being edited stays a letter, not a tool change', async () => {
    renderBoard();
    await runFrames();
    const id = await addNote(0, 0);
    fireEvent.doubleClick(noteElement(id), { clientX: 300, clientY: 300 });
    await runFrames();
    const input = screen.getByTestId('sticky-note-input');
    expect(input).toHaveFocus();

    // the keystroke belongs to the note: neither the editor's field nor the page is told to drop it
    const inField = dispatchKey(input, { key: 't' });
    expect(inField.defaultPrevented).toBe(false);
    const onWindow = dispatchKey(window, { key: 't' });
    expect(onWindow.defaultPrevented).toBe(false);

    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport()).toHaveAttribute('data-tool', 'select');
    // and the note is still being edited, its text untouched by a tool change
    expect(input).toHaveFocus();
  });

  test('TC-18 N still creates a sticky note in the middle of the view', async () => {
    renderBoard();
    await runFrames();

    dispatchKey(window, { key: 'n' });
    await runFrames();

    const notes = objects().filter(isStickySnapshot);
    expect(notes).toHaveLength(1);
    const centre = screenToWorld(getCamera(), {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    expect(notes[0]!.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]!.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    expect(screen.getByTestId('sticky-note-input')).toHaveFocus();
    // the note button is not a tool: the board stays on Select
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('text.tool.placing', () => {
  test('TC-17 with the Text tool up, a click on the board writes there', async () => {
    renderBoard();
    await runFrames();
    await originCamera();

    dispatchKey(window, { key: 't' });
    fireEvent.pointerDown(viewport(), pointer(300, 200));
    fireEvent.pointerUp(viewport(), pointer(300, 200));
    await runFrames();

    const texts = objects().filter(isTextSnapshot);
    expect(texts).toHaveLength(1);
    // the top-left corner of the new text is the point that was clicked
    expect(texts[0]!.x).toBeCloseTo(300, 6);
    expect(texts[0]!.y).toBeCloseTo(200, 6);
    expect(texts[0]!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(texts[0]!.widthMode).toBe('auto');
    expect(texts[0]!.text).toBe('');

    // the tool hands straight back to Select, and the new text is the one being written
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(viewport()).toHaveAttribute('data-tool', 'select');
    const selected = objects().filter((object) => object.id === texts[0]!.id);
    expect(selected).toHaveLength(1);
  });

  test('a click on top of a note writes text there and leaves the note alone', async () => {
    renderBoard();
    await runFrames();
    const noteId = await addNote(0, 0);
    const placed = objects().find((object) => object.id === noteId);
    const at = { x: placed?.x, y: placed?.y };
    await originCamera();

    dispatchKey(window, { key: 't' });
    fireEvent.pointerDown(noteElement(noteId), pointer(300, 300));
    fireEvent.pointerMove(noteElement(noteId), pointer(420, 380));
    fireEvent.pointerUp(noteElement(noteId), pointer(420, 380));
    await runFrames();

    const texts = objects().filter(isTextSnapshot);
    expect(texts).toHaveLength(1);
    // the gesture that would have dragged the note dragged nothing: it was a click on the board
    const note = objects().find((object) => object.id === noteId);
    expect(note?.x).toBe(at.x);
    expect(note?.y).toBe(at.y);
    expect(noteElement(noteId)).not.toHaveAttribute('data-selected', 'true');
  });

  test('the double-click that placed a text does not also create a sticky note', async () => {
    renderBoard();
    await runFrames();
    await originCamera();

    dispatchKey(window, { key: 't' });
    fireEvent.pointerDown(viewport(), pointer(300, 200));
    fireEvent.pointerUp(viewport(), pointer(300, 200));
    await runFrames();

    // the second click of the same gesture: the tool has already handed back to Select, and the
    // double-click action of the board - a sticky note - must not answer it
    fireEvent.pointerDown(viewport(), pointer(301, 201));
    fireEvent.pointerUp(viewport(), pointer(301, 201));
    fireEvent.doubleClick(viewport(), { clientX: 301, clientY: 201 });
    await runFrames();

    expect(objects().filter(isStickySnapshot)).toHaveLength(0);
  });

  test('the Text tool does not pan and does not start a marquee', async () => {
    renderBoard();
    await runFrames();
    await originCamera();
    const before = getCamera();

    dispatchKey(window, { key: 't' });
    fireEvent.pointerDown(viewport(), pointer(200, 200, { shiftKey: true }));
    fireEvent.pointerMove(viewport(), pointer(600, 500, { shiftKey: true }));
    fireEvent.pointerUp(viewport(), pointer(600, 500, { shiftKey: true }));
    await runFrames();

    expect(getCamera()).toEqual(before);
    expect(viewport()).toHaveAttribute('data-interaction-state', 'idle');
    // one text at the point the gesture started, and nothing was selected by the drag
    expect(objects().filter(isTextSnapshot)).toHaveLength(1);
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();
  });
});
