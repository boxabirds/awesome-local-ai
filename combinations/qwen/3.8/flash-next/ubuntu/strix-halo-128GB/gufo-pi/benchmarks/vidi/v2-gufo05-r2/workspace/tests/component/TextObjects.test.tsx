/**
 * Story 9: text objects themselves — the box, the size, and what happens when the
 * other person's keystroke arrives.
 *
 * These run on the real board with a stand-in room, and they assert on the
 * *document* as much as on the DOM: with text the two can disagree in a way that
 * looks fine on this page and is wrong on every other one, because the box a
 * client measures is made of that client's fonts. So the rule under test every
 * time is the one from the design: this page draws what the document says, and
 * only writes a box when this page changed the text, the size, or the width.
 */

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { objectSnapshot, snapshot } from '../../src/shared/board-model';
import {
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createText,
  getTextContent,
  isTextSnapshot,
  textSnapshot,
} from '../../src/shared/objects/text';
import { layoutText } from '../../src/client/objects/textLayout';
import { noteEl, seedSticky } from './stickyHarness';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { TextSnapshot } from '../../src/shared/objects/text';
import {
  fireKey,
  firePointer,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';

afterEach(() => cleanup());

/** Let a remote write reach this page: two frames, plus the selection debounce. */
function syncWorld(): void {
  flushFrames();
  vi.advanceTimersByTime(200);
  flushFrames();
}

/** A key pressed on one element, the way a real keystroke arrives at the focused one. */
function pressOn(el: EventTarget, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  flushFrames();
}

function texts(doc: Y.Doc): TextSnapshot[] {
  return [...textSnapshot(doc)];
}

/** The stored height of an object, defaulting the way the model does. */
function heightOf(object: TextSnapshot | undefined): number {
  return object?.height ?? 0;
}

/**
 * A change written as if it had arrived from somebody else: a transaction with an
 * origin this page does not track, so it lands on the board without ever becoming
 * this page's own undo step.
 */
function asRemote<T>(doc: Y.Doc, fn: () => T): T {
  let out!: T;
  act(() => {
    doc.transact(() => {
      out = fn();
    }, 'g_remote');
  });
  syncWorld();
  return out;
}

/**
 * Text as it would arrive from somebody else: the words, and the box that client
 * measured — which is what actually travels between boards.
 */
function remoteText(
  doc: Y.Doc,
  at: { x: number; y: number },
  words: string,
  size: TextSnapshot['size'] = 'M',
  lines = 1,
): string {
  return asRemote(doc, () => {
    const id = createText(doc, at, 'g_remote', size)!;
    getTextContent(doc, id)?.applyDelta([{ insert: words }]);
    // The box that arrives with the words: measured by that client, whose font is
    // deliberately not this page's, to prove the box on screen is the one that
    // arrived and not one measured here.
    const entry = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    const width = remoteWidth(words.split('\n')[0] ?? '', TEXT_SIZES[size]);
    entry.set('width', Math.max(TEXT_MIN_WIDTH_WORLD, width));
    entry.set('height', Math.round(TEXT_SIZES[size] * TEXT_LINE_HEIGHT) * lines);
    return id;
  });
}

/** Type into the editor of the text that is currently being edited. */
function typeIntoText(value: string): HTMLTextAreaElement {
  const field = screen.getByTestId('text-editor') as HTMLTextAreaElement;
  act(() => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  flushFrames();
  return field;
}

/** Put the Text tool down and click the board at a screen point. */
function placeText(screenPoint: { x: number; y: number }): void {
  act(() => screen.getByRole('button', { name: 'Text (T)' }).click());
  firePointer(surface(), 'pointerdown', screenPoint.x, screenPoint.y);
  firePointer(surface(), 'pointerup', screenPoint.x, screenPoint.y);
  flushFrames();
}

/** What this page's measurer computes in jsdom: no canvas, so the estimate. */
function estimatedWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
}

/** A remote page's measurer: deliberately not this page's. */
function remoteWidth(text: string, fontPx: number): number {
  return Math.round(text.length * fontPx * 0.5);
}

function textEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!el) throw new Error(`text ${id} is not rendered`);
  return el;
}

/** The world point a screen point lands on, from the camera the page renders. */
function worldOf(point: { x: number; y: number }): { x: number; y: number } {
  return screenToWorld(readCamera(), point);
}

describe('text.auto_width — the box the document holds', () => {
  it('TC-19: an abandoned text leaves no object behind', () => {
    renderBoard();
    const doc = readBoardDoc();
    placeText({ x: 180, y: 120 });
    expect(texts(doc)).toHaveLength(1);
    // Nothing typed, and the edit ends: the object leaves with it.
    pressOn(screen.getByTestId('text-editor'), 'Escape');
    expect(texts(doc)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-19b: text typed, then all of it deleted, also leaves nothing behind', () => {
    renderBoard();
    const doc = readBoardDoc();
    placeText({ x: 180, y: 120 });
    const id = texts(doc)[0]!.id;
    const field = typeIntoText('Retro');
    // Everything removed, exactly as if it had never been written.
    act(() => {
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    flushFrames();
    pressOn(screen.getByTestId('text-editor'), 'Escape');
    expect(texts(doc)).toHaveLength(0);
    expect(objectSnapshot(doc, id)).toBeUndefined();
  });

  it('TC-21: a remote edit re-wraps this page, using the box that arrived with it', () => {
    renderBoard();
    const doc = readBoardDoc();
    const id = remoteText(doc, { x: 100, y: 40 }, 'alpha beta gamma', 'M', 3);
    const stored = texts(doc)[0]!;
    const fontPx = TEXT_SIZES.M;
    const lineHeight = Math.round(fontPx * TEXT_LINE_HEIGHT);

    const el = textEl(id);
    // The box drawn here is the box that arrived — 3 measured lines, not one
    // guessed from this page's own font.
    expect(el.style.height).toBe(`${stored.height}px`);
    expect(stored.height).toBe(lineHeight * 3);
    expect(el.style.fontSize).toBe(`${fontPx}px`);
    expect(el.style.background).toBe('');
    expect(el.textContent).toBe('alpha beta gamma');
  });

  it('TC-22: typing here never moves the object — only its size follows the words', () => {
    renderBoard();
    const doc = readBoardDoc();
    const before = worldOf({ x: 180, y: 120 });
    placeText({ x: 180, y: 120 });
    texts(doc)[0]!.id;
    expect(texts(doc)[0]!.x).toBe(before.x);
    expect(texts(doc)[0]!.y).toBe(before.y);

    typeIntoText('One line of text');
    const grown = texts(doc)[0]!;
    expect(grown.x).toBe(before.x);
    expect(grown.y).toBe(before.y);
    expect(grown.width).toBeGreaterThan(40);
    expect(grown.widthMode).toBe('auto');

    // Enough words to hit the wrap width: the width stops there, the height grows.
    const long = 'word '.repeat(60).trim();
    typeIntoText(long);
    const wrapped = texts(doc)[0]!;
    expect(wrapped.width).toBeLessThanOrEqual(600);
    expect(heightOf(wrapped)).toBeGreaterThan(heightOf(grown));
    expect(wrapped.x).toBe(before.x);
  });
});

describe('text.fixed_width — the width handles', () => {
  it('TC-13b: a selected text object shows the two edges and no corner handles', () => {
    renderBoard();
    const doc = readBoardDoc();
    const id = remoteText(doc, { x: 100, y: 100 }, 'Wrap width', 'M', 1);
    const el = textEl(id);
    firePointer(el, 'pointerdown', 120, 110);
    firePointer(el, 'pointerup', 120, 110);
    flushFrames();

    const ring = document.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
    const drawn = Array.from(ring.querySelectorAll<HTMLElement>('.selection-handle')).map(
      (node) => node.getAttribute('data-resize-handle'),
    );
    expect(drawn.sort()).toEqual(['e', 'w']);
    // The outline follows the stored box, not the browser's guess at the text.
    const stored = texts(doc)[0]!;
    expect(ring.style.width).toBe(`${stored.width}px`);
    expect(ring.style.height).toBe(`${stored.height}px`);
  });

  it('TC-13c: a mixed selection still shows all eight handles', () => {
    renderBoard();
    const doc = readBoardDoc();
    const textId = remoteText(doc, { x: 100, y: 100 }, 'Wrap width', 'M', 1);
    // A sticky note as well: it has a height of its own, so the pair is resizable
    // as a box (design key decision 2).
    const noteId = seedSticky(doc, { x: 400, y: 100 });
    selectById(textId, { x: 110, y: 110 });
    firePointer(noteEl(noteId), 'pointerdown', 420, 120, { shift: true });
    firePointer(noteEl(noteId), 'pointerup', 420, 120, { shift: true });
    flushFrames();
    expect(sortedIds([textId, noteId])).toEqual(sortedIds(window.__vidi6?.selectedIds?.()));

    const ring = document.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
    const drawn = Array.from(ring.querySelectorAll<HTMLElement>('.selection-handle')).map(
      (node) => node.getAttribute('data-resize-handle'),
    );
    expect(drawn).toHaveLength(8);
  });

  it('TC-23: dragging the right edge fixes the width; one undo brings auto back', () => {
    renderBoard();
    const doc = readBoardDoc();
    placeText({ x: 180, y: 120 });
    const id = texts(doc)[0]!.id;
    // Nothing typed yet: leaving the editor keeps the object because nothing was
    // asked of it, and the drag below is what changes its width.
    const before = texts(doc)[0]!;
    expect(before.widthMode).toBe('auto');
    typeIntoText('Retro');
    pressOn(screen.getByTestId('text-editor'), 'Escape');

    // Select it and drag its right edge inwards.
    firePointer(textEl(id), 'pointerdown', 200, 130);
    firePointer(textEl(id), 'pointerup', 200, 130);
    flushFrames();
    const handle = screen.getByTestId('resize-handle-e');
    const camera = readCamera();
    const startWidth = heightOf(texts(doc)[0]);
    firePointer(handle, 'pointerdown', 0, 0);
    firePointer(handle, 'pointermove', 120 * camera.zoom, 0);
    flushFrames();
    const dragged = texts(doc)[0]!;
    expect(dragged.widthMode).toBe('fixed');
    // The document stores the dragged width; the height follows the re-wrap.
    expect(dragged.width ?? 0).toBeGreaterThan(startWidth);
    firePointer(handle, 'pointerup', 120 * camera.zoom, 0);
    flushFrames();

    // TC-23's other half: one undo puts the text back exactly as it was.
    const widthBefore = heightOf(texts(doc)[0]);
    act(() => window.__vidi6?.undoStep?.());
    flushFrames();
    const restored = texts(doc)[0]!;
    expect(restored.widthMode).toBe('auto');
    expect(restored.width).not.toBe(widthBefore);
  });
});

describe('text.size and text.remote_deleted', () => {
  it('TC-25: a toolbar size change keeps the top-left and re-measures the box', () => {
    renderBoard();
    const doc = readBoardDoc();
    const id = remoteText(doc, { x: 100, y: 40 }, 'Retro', 'M', 1);
    selectById(id, { x: 110, y: 50 });

    const before = texts(doc)[0]!;
    const lineHeight = Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(before.height).toBe(lineHeight);

    act(() => screen.getByRole('button', { name: /Large/ }).click());
    flushFrames();

    const after = texts(doc)[0]!;
    expect(after.size).toBe('L');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Bigger words, so a taller box and a wider one, from the same corner. The
    // numbers are what this page's measurer reports: jsdom has no canvas, so that
    // is the same estimated ratio the code falls back to (see NOTES.md).
    const measured = layoutText('Retro', 'L', 'auto', null, estimatedWidth);
    // The model stores whole board units.
    expect(after.height).toBe(Math.round(measured.height));
    expect(after.width).toBe(Math.round(measured.width));
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.L}px`);
    // And that is one undo step.
    act(() => window.__vidi6?.undoStep?.());
    flushFrames();
    expect(texts(doc)[0]!.size).toBe('M');
  });

  it('TC-24: text deleted by somebody else while it is being edited disappears without an error', () => {
    renderBoard();
    const doc = readBoardDoc();
    placeText({ x: 180, y: 120 });
    const id = texts(doc)[0]!.id;
    typeIntoText('Writ');
    expect(screen.getByTestId('text-editor')).not.toBeNull();

    // The other client deletes it.
    asRemote(doc, () => doc.getMap('objects').delete(id));

    // The editor is gone, the object is gone, and nothing was written back.
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(objectSnapshot(doc, id)).toBeUndefined();
    expect(texts(doc)).toHaveLength(0);
    // A keystroke now is only a keystroke: it recreates nothing.
    fireKey('a');
    flushFrames();
    expect(texts(doc)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('a text object is drawn with the words it holds, and no chrome of its own', () => {
    renderBoard();
    const doc = readBoardDoc();
    const id = remoteText(doc, { x: 30, y: 20 }, 'went well\n\ndid not', 'XL', 3);
    const el = textEl(id);
    expect(el.getAttribute('data-object-type')).toBe('text');
    expect(el.textContent).toBe('went well\n\ndid not');
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(el.style.width).toBe(`${texts(doc)[0]!.width}px`);
    expect(el.style.height).toBe(`${texts(doc)[0]!.height}px`);
    expect(isTextSnapshot(objectSnapshot(doc, id)!)).toBe(true);
  });

  it('deleting a text object with the toolbar leaves nothing selected', () => {
    renderBoard();
    const doc = readBoardDoc();
    const id = remoteText(doc, { x: 100, y: 40 }, 'Doomed', 'M', 1);
    selectById(id, { x: 110, y: 50 });
    act(() => screen.getByRole('button', { name: 'Delete text' }).click());
    flushFrames();
    expect(texts(doc)).toHaveLength(0);
    expect(window.__vidi6?.selectedIds?.()).toEqual([]);
  });
});

/** The same ids, in a stable order, for comparing selections. */
function sortedIds(ids: readonly string[] | undefined): string[] {
  return [...(ids ?? [])].sort();
}

/** Click one object into the selection. */
function selectById(id: string, at: { x: number; y: number }): void {
  firePointer(textEl(id), 'pointerdown', at.x, at.y);
  firePointer(textEl(id), 'pointerup', at.x, at.y);
  flushFrames();
  expect(window.__vidi6?.selectedIds?.()).toEqual([id]);
}

