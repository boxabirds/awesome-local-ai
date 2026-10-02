import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebsocketProvider } from 'y-websocket';
import { Board } from '../../src/client/board/Board';
import { screenToWorld, type Camera } from '../../src/client/canvas/camera';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { snapshotAll } from '../../src/shared/board-model';
import {
  createNote,
  editorOf,
  flushFrame,
  noteCount,
  pressOn,
  releaseOn,
  renderBoard,
  shiftPressOn,
  shiftReleaseOn,
  surfaceOf,
  textCount,
  textData,
} from './helpers';

/**
 * TC-14 to TC-18: the tool the board is in.
 *
 * The tool is a small state with one job — it decides what the next click on the
 * board becomes — so these tests are mostly about what it does *not* touch: not
 * the camera, not the selection, not the keys an object's editor is already using,
 * and not a board that cannot be written.
 */

let doc: Doc;

function toolButton(name: 'Select (V)' | 'Text (T)'): HTMLElement {
  return screen.getByRole('button', { name });
}

function pressed(name: 'Select (V)' | 'Text (T)'): boolean {
  return toolButton(name).getAttribute('aria-pressed') === 'true';
}

function pressKey(
  key: string,
  target: Window | Document | Node | Element = window,
  init: Record<string, unknown> = {},
): void {
  fireEvent.keyDown(target, { key, ...init });
}

/** The camera the board is showing, read back off the world layer it draws:
 * the layer is `scale(zoom) translate(tx, ty)`, so a screen point p is world
 * p / zoom - t, which is the camera this board is looking through. */
function cameraOf(view: HTMLElement): Camera {
  const transform = view.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform;
  const zoom = Number(/scale\(([-0-9.]+)\)/.exec(transform)?.[1]);
  const translate = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(transform);
  return { x: -Number(translate![1]), y: -Number(translate![2]), zoom };
}

describe('choosing a tool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    doc = renderBoard();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-14 puts the board in the Text tool on T and out of it on Escape and V', () => {
    expect(pressed('Select (V)')).toBe(true);
    expect(pressed('Text (T)')).toBe(false);

    pressKey('t');
    flushFrame();
    expect(pressed('Text (T)')).toBe(true);
    expect(pressed('Select (V)')).toBe(false);

    // Escape leaves without creating anything.
    pressKey('Escape');
    flushFrame();
    expect(pressed('Select (V)')).toBe(true);
    expect(textCount()).toBe(0);

    // And V is the same way out.
    pressKey('t');
    flushFrame();
    pressKey('v');
    flushFrame();
    expect(pressed('Select (V)')).toBe(true);
    expect(textCount()).toBe(0);
  });

  it('TC-14 puts the board in the Text tool from its own button, without a key', () => {
    const view = document.querySelector<HTMLElement>('[data-testid="toolbar"]')!;
    fireEvent.click(within(view).getByRole('button', { name: 'Text (T)' }));
    flushFrame();
    expect(pressed('Text (T)')).toBe(true);
    // Pressing the tool that is already pressed is not a toggle: it is the tool
    // the board was asked for, and it stays the tool it is.
    fireEvent.click(within(view).getByRole('button', { name: 'Text (T)' }));
    flushFrame();
    expect(pressed('Text (T)')).toBe(true);
    fireEvent.click(within(view).getByRole('button', { name: 'Select (V)' }));
    flushFrame();
    expect(pressed('Select (V)')).toBe(true);
  });

  it('TC-14 takes the pointer over the board with the tool, and hands it back', () => {
    const surface = surfaceOf(document.querySelector<HTMLElement>('.app')!);
    expect(surface).not.toHaveAttribute('data-cursor');

    pressKey('t');
    flushFrame();
    expect(surface.getAttribute('data-cursor')).toBe('text');
    expect(surface.className).toContain('is-text-tool');

    pressKey('Escape');
    flushFrame();
    expect(surface).not.toHaveAttribute('data-cursor');
  });

  it('TC-16 leaves the letter t in the note that was being typed into', () => {
    const id = createNote(doc, 100, 100);
    const editor = openTextEditorOfNote(id);
    // A letter the person is typing is not a shortcut, whoever it sounds like.
    pressKey('t', editor);
    fireEvent.input(editor, { target: { value: 'sprint' } });
    flushFrame();

    expect(editor.value).toBe('sprint');
    expect(pressed('Text (T)')).toBe(false);
    expect(textCount()).toBe(0);
  });

  it('TC-18 still makes a sticky note on N, and leaves the board in Select', () => {
    const before = noteCount();
    pressKey('n');
    flushFrame();
    expect(noteCount()).toBe(before + 1);
    expect(pressed('Select (V)')).toBe(true);
    expect(textCount()).toBe(0);

    // Including out of the Text tool: N says what to make, not what tool to be in.
    pressKey('t');
    flushFrame();
    pressKey('n');
    flushFrame();
    expect(noteCount()).toBe(before + 2);
    expect(pressed('Select (V)')).toBe(true);
    expect(textCount()).toBe(0);
  });

  it('TC-17 makes a text object at the point clicked and is back in Select after it', () => {
    const view = document.querySelector<HTMLElement>('.app')!;
    const surface = surfaceOf(view);
    pressKey('t');
    flushFrame();

    pressOn(surface, 300, 200);
    releaseOn(surface, 300, 200);
    flushFrame();

    expect(textCount()).toBe(1);
    const created = snapshotAll(doc).find((object) => object.type === 'text')!;
    // Its top-left is the point that was clicked, in world units — not the screen
    // coordinates of the click, which is the conversion the tool has to get right.
    const expected = screenToWorld(cameraOf(view), { x: 300, y: 200 });
    expect(created.x).toBeCloseTo(expected.x, 6);
    expect(created.y).toBeCloseTo(expected.y, 6);
    // Size M, the width the text has not yet had to decide, and nothing typed.
    expect(created.size).toBe('M');
    expect(created.widthMode).toBe('auto');
    expect(created.text).toBe('');
    // The board is back in Select, and the new object is being edited.
    expect(pressed('Select (V)')).toBe(true);
    expect(editorOf(created.id)).toBeTruthy();
  });

  it('TC-17 places text on top of an object that was already there', () => {
    const note = createNote(doc, 200, 100);
    const view = document.querySelector<HTMLElement>('.app')!;
    pressKey('t');
    flushFrame();

    // The note takes the pointer for itself — that is how it gets dragged — and
    // the tool still hears where the click was, because the tool is not asking
    // the note's permission.
    const noteEl = document.querySelector<HTMLElement>(`[data-note-id="${note}"]`)!;
    pressOn(noteEl, 260, 160);
    releaseOn(noteEl, 260, 160);
    flushFrame();

    expect(textCount()).toBe(1);
    const created = snapshotAll(doc).find((object) => object.type === 'text')!;
    const expected = screenToWorld(cameraOf(view), { x: 260, y: 160 });
    expect(created.x).toBeCloseTo(expected.x, 6);
    expect(created.y).toBeCloseTo(expected.y, 6);
  });

  it('TC-17 does not pan or marquee the board while the Text tool is active', () => {
    const surface = surfaceOf(document.querySelector<HTMLElement>('.app')!);
    pressKey('t');
    flushFrame();

    // A drag is a drag in Select and a nothing in Text: the board does not move,
    // and no text is placed at either end of it.
    const worldBefore = surface.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform;
    pressOn(surface, 400, 400);
    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 700, clientY: 500 });
    releaseOn(surface, 700, 500);
    flushFrame();
    expect(surface.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform).toBe(worldBefore);
    expect(textCount()).toBe(0);
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();

    // The tool is still the tool it was: the drag was not an attempt to leave it.
    expect(pressed('Text (T)')).toBe(true);

    // A shift-drag does not marquee either, for the same reason.
    shiftPressOn(surface, 100, 100);
    fireEvent.pointerMove(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse', shiftKey: true, clientX: 500, clientY: 500 });
    shiftReleaseOn(surface, 500, 500);
    flushFrame();
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();
    expect(textCount()).toBe(0);
  });

  it('TC-17 places one object per click, so a double-click cannot make two', () => {
    const surface = surfaceOf(document.querySelector<HTMLElement>('.app')!);
    pressKey('t');
    flushFrame();
    pressOn(surface, 320, 220);
    releaseOn(surface, 320, 220);
    flushFrame();
    const id = snapshotAll(doc).find((object) => object.type === 'text')!.id;
    const editor = editorOf(id);
    expect(editor).toBeTruthy();

    // The second click of a double-click is a click on the editor the first one
    // opened, and an object being edited keeps its clicks: no second object is
    // placed under it, and no sticky note is made by the double-click.
    pressOn(editor!, 320, 220);
    releaseOn(editor!, 320, 220);
    fireEvent.doubleClick(editor!, { clientX: 320, clientY: 220 });
    flushFrame();
    expect(textCount()).toBe(1);
    expect(noteCount()).toBe(0);
    expect(textData(doc, id)).toBeDefined();
    expect(editorOf(id)).toBeTruthy();
  });
});

describe('a board that cannot be written', () => {
  // Reached the honest way: the room closes this board's link with the code it
  // sends when the board on disk could not be read. Real timers here, as in the
  // story 4 test that reaches the same state: the socket has to actually open.
  let provider: WebsocketProvider;
  let view: HTMLElement;

  beforeEach(() => {
    let capturedProvider: WebsocketProvider | null = null;
    act(() => {
      render(
        <Board
          onDocReady={(d: Doc) => {
            doc = d;
          }}
          onProviderReady={(p: WebsocketProvider) => {
            capturedProvider = p;
          }}
        />,
      );
    });
    view = document.querySelector<HTMLElement>('.app')!;
    if (capturedProvider === null) throw new Error('the board did not connect');
    provider = capturedProvider;
  });

  afterEach(() => {
    cleanup();
  });

  it('TC-15 disables the Text tool and ignores T on a board whose load failed', () => {
    act(() => {
      provider.emit('connection-close', [{ code: CLOSE_BOARD_LOAD_FAILED }, provider] as never);
    });

    const text = screen.getByRole('button', { name: 'Text (T)' });
    expect(text).toBeDisabled();
    expect(text).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sticky note' })).toBeDisabled();

    pressKey('t');
    expect(text).toHaveAttribute('aria-pressed', 'false');
    expect(textCount()).toBe(0);

    // And a click on the board, which is the tool's whole act, creates nothing.
    const surface = surfaceOf(view);
    pressOn(surface, 300, 300);
    releaseOn(surface, 300, 300);
    expect(textCount()).toBe(0);
    expect(noteCount()).toBe(0);
    // Seeing the board is left alone.
    expect(screen.getByRole('button', { name: 'Select (V)' })).toBeEnabled();
  });
});

/** Story 2's editor for a note, opened the way a person opens it. */
function openTextEditorOfNote(id: string): HTMLTextAreaElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`)!;
  fireEvent.doubleClick(el, { clientX: 100, clientY: 100 });
  const editor = el.querySelector<HTMLTextAreaElement>('textarea');
  if (editor === null) throw new Error('the note did not open its editor');
  return editor;
}
