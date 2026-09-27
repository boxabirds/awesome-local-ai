// Story 9, task 9: component tests for text objects (TC-19 to TC-25).
//
// The App is rendered against a mocked connector. Text objects are created
// through the real Text tool (T + click) so the full path runs: createText,
// selection, startEdit, TextEditor mount.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import {
  deleteObjects,
  getStickyText,
  objectSnapshot,
} from '../../src/shared/board-model';
import {
  getTextContent,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type StickyColor } from '../../src/shared/config';
import {
  resetBoardForTests,
  setBoardCamera,
} from '../../src/client/canvas/useCamera';
import { makeEvent } from './helpers';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { worldToScreen, type Camera } from '../../src/client/canvas/camera';

const SEED = vi.hoisted(() => ({
  notes: [] as Array<{ x: number; y: number; color: StickyColor }>,
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  const boardModel = await import('../../src/shared/board-model');
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      SEED.doc = doc;
      queueMicrotask(() => {
        if (boardModel.objectSnapshot(doc).length !== 0) return;
        for (const n of SEED.notes) boardModel.createStickyAt(doc, n.x, n.y, n.color);
      });
      return { destroy: (): void => undefined };
    },
  };
});

// World (0,0) at screen (512,384), zoom 1 (jsdom 1024x768).
const CAM: Camera = { x: -512, y: -384, zoom: 1 };

function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}

function pressKey(key: string, init: Record<string, unknown> = {}): void {
  dis(window, 'keydown', { key, ...init });
}

function clickBoardAt(x: number, y: number): void {
  const vp = screen.getByTestId('board-viewport');
  dis(vp, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  dis(vp, 'pointerup', { pointerId: 1, clientX: x, clientY: y });
}

async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  act(() => {
    setBoardCamera(CAM);
  });
}

/** T + click at world (wx, wy) -> a new text object being edited; its id. */
function createTextAt(wx: number, wy: number): string {
  pressKey('t');
  const sp = worldToScreen(CAM, { x: wx, y: wy });
  clickBoardAt(sp.x, sp.y);
  const snap = objectSnapshot(SEED.doc!).find((o) => o.type === 'text');
  if (snap === undefined) throw new Error('text object was not created');
  return snap.id;
}

function textSnap(id: string): TextSnapshot {
  const snap = objectSnapshot(SEED.doc!).find((o) => o.id === id) as TextSnapshot;
  if (snap === undefined) throw new Error('text object missing');
  return snap;
}

function typeText(value: string): void {
  fireEvent.input(screen.getByLabelText('Text object text'), { target: { value } });
}

describe('story 9: text objects (TC-19..TC-25)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.notes = [];
    SEED.state = 'connected';
    SEED.doc = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('TC-19: caret at end on re-edit; Enter inserts a newline; Escape keeps the text selected', async () => {
    await openBoard();
    const id = createTextAt(0, 0);

    typeText('a');
    typeText('ab');
    pressKey('Escape');
    expect(getTextContent(SEED.doc!, id)!.toString()).toBe('ab');

    // Re-edit: the editor mounts with the caret at the END of the text.
    const obj = screen.getByTestId('text-object');
    dis(obj, 'dblclick', {});
    const ta = screen.getByLabelText('Text object text') as HTMLTextAreaElement;
    expect(ta.value).toBe('ab');
    expect(ta.selectionStart).toBe(2);

    // Enter inserts a newline (the editor does not intercept it).
    fireEvent.keyDown(ta, { key: 'Enter' });
    typeText('ab\n');
    expect(getTextContent(SEED.doc!, id)!.toString()).toBe('ab\n');

    // Escape ends editing; the text stays selected (not removed).
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByLabelText('Text object text')).toBeNull();
    const after = screen.getByTestId('text-object');
    expect(after.hasAttribute('data-selected')).toBe(true);
    expect(getTextContent(SEED.doc!, id)!.toString()).toBe('ab\n');
  });

  it('TC-20: Escape with zero characters removes the object and clears the selection', async () => {
    await openBoard();
    const id = createTextAt(0, 0);

    fireEvent.keyDown(screen.getByLabelText('Text object text'), { key: 'Escape' });

    expect(objectSnapshot(SEED.doc!)).toHaveLength(0); // no invisible text
    expect(screen.queryByTestId('text-object')).toBeNull();
    // The selection is cleared: no selection chrome at all.
    expect(screen.queryByRole('button', { name: 'Resize e' })).toBeNull();
    expect(getTextContent(SEED.doc!, id)).toBeUndefined();
  });

  it('TC-21: the TextToolbar shows S/M/L/XL with M pressed; XL keeps x/y and remeasures', async () => {
    await openBoard();
    const id = createTextAt(100, 100);
    typeText('Hello');
    fireEvent.keyDown(screen.getByLabelText('Text object text'), { key: 'Escape' });

    const sizes = ['S', 'M', 'L', 'XL'].map((s) =>
      screen.getByRole('button', { name: `Text size ${s}` }),
    );
    expect(sizes.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);

    const before = textSnap(id);
    expect(before.x).toBe(100);
    expect(before.y).toBe(100);

    act(() => {
      sizes[3].click(); // XL
    });

    const after = textSnap(id);
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x); // top-left unchanged
    expect(after.y).toBe(before.y);
    // The box remeasured at XL: one line of 'Hello' at XL line height.
    expect(after.height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    expect(screen.getByRole('button', { name: 'Text size XL' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('TC-22: a single selected text shows only the e and w handles', async () => {
    await openBoard();
    createTextAt(0, 0);
    typeText('Hi');
    fireEvent.keyDown(screen.getByLabelText('Text object text'), { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Resize e' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Resize w' })).not.toBeNull();
    for (const h of ['nw', 'n', 'ne', 'se', 's', 'sw']) {
      expect(screen.queryByRole('button', { name: `Resize ${h}` })).toBeNull();
    }
  });

  it('TC-23: text + sticky selected shows all handles; a resize repositions the text, font unchanged', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();

    // Text at world (400, 100), a word long, then end editing (selected).
    const id = createTextAt(400, 100);
    typeText('Hi');
    fireEvent.keyDown(screen.getByLabelText('Text object text'), { key: 'Escape' });

    // Shift+click the sticky: mixed group selection.
    const note = screen.getByRole('group', { name: 'Sticky note' });
    dis(note, 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      shiftKey: true,
    });
    dis(window, 'pointerup', { pointerId: 1 });

    // Mixed selection: the full story 7 handle set.
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(screen.queryByRole('button', { name: `Resize ${h}` })).not.toBeNull();
    }

    // Drag the east handle +100 (screen px; zoom 1).
    const textBefore = textSnap(id);
    drag(screen.getByRole('button', { name: 'Resize e' }), 100, 0);
    const textAfter = textSnap(id);

    // The group box grew by 100 in width: x = 100, w = 324 -> 424; scale 424/324.
    const scale = 424 / 324;
    expect(textAfter.x).toBeCloseTo(100 + (textBefore.x - 100) * scale, 5);
    expect(textAfter.y).toBe(textBefore.y); // y delta was 0
    // The text keeps its content-derived size (it is not scaled)...
    expect(textAfter.width).toBe(textBefore.width);
    expect(textAfter.height).toBe(textBefore.height);
    // ...and its font size is unchanged.
    const el = screen.getByTestId('text-object');
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    // The sticky was scaled by the same factor (aspect locked).
    const noteEl = screen.getByRole('group', { name: 'Sticky note' });
    expect(Number(noteEl.style.width.replace('px', ''))).toBeCloseTo(200 * scale, 5);
  });

  it('TC-24: a remote delete while editing unmounts the editor silently', async () => {
    await openBoard();
    const id = createTextAt(0, 0);
    typeText('ab');
    expect(screen.getByLabelText('Text object text')).toBeTruthy();

    act(() => {
      deleteObjects(SEED.doc!, [id]); // a peer deleted it
    });

    expect(screen.queryByLabelText('Text object text')).toBeNull(); // unmounted
    expect(screen.queryByTestId('text-object')).toBeNull(); // not recreated
    expect(objectSnapshot(SEED.doc!)).toHaveLength(0);
  });

  it('TC-25: typing and its box remeasure revert together in one undo step', async () => {
    await openBoard();
    const id = createTextAt(0, 0);
    const ta = screen.getByLabelText('Text object text');
    const creationBox = { w: textSnap(id).width!, h: textSnap(id).height! };

    typeText('a');
    typeText('ab');
    typeText('abcdefgh');
    expect(textSnap(id).width).toBeGreaterThan(creationBox.w); // remeasured (8 chars > 40px min)

    // End editing (its own step), then one undo: the whole typing burst
    // (text + box) reverts in a single step.
    fireEvent.keyDown(ta, { key: 'Escape' });
    pressKey('z', { ctrlKey: true });

    expect(getTextContent(SEED.doc!, id)!.toString()).toBe('');
    expect(textSnap(id).width).toBe(creationBox.w);
    expect(textSnap(id).height).toBe(creationBox.h);

    // One more undo removes the creation itself (steps are separate).
    pressKey('z', { ctrlKey: true });
    expect(objectSnapshot(SEED.doc!)).toHaveLength(0);
  });
});

/** Drag an element/handle by a screen delta (zoom 1 => world delta = delta). */
function drag(el: HTMLElement, dx: number, dy: number): void {
  dis(el, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
  });
  dis(window, 'pointermove', { pointerId: 1, clientX: dx, clientY: dy });
  dis(window, 'pointerup', { pointerId: 1 });
}
