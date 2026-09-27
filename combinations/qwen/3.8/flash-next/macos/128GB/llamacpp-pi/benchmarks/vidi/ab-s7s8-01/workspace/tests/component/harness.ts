import { act } from '@testing-library/react';
import type * as Y from 'yjs';
import { deleteObject } from '../../src/shared/board-model';
import { createTestbox } from '../fixtures/testbox';
import type { Rect } from '../../src/shared/geometry';

/** Build a pointer-style event (jsdom has no PointerEvent constructor; React
 * dispatches by event name, so a MouseEvent carrying a pointerId is enough). */
export interface PointerOptions {
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Build a pointer-style event (jsdom has no PointerEvent constructor; React
 * dispatches by event name, so a MouseEvent carrying a pointerId is enough). */
export function pointerEvent(type: string, x: number, y: number, buttonOrOptions: number | PointerOptions = 0): MouseEvent {
  const opts: PointerOptions = typeof buttonOrOptions === 'number' ? { button: buttonOrOptions } : buttonOrOptions;
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: opts.button ?? 0,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
  });
  (ev as unknown as { pointerId: number }).pointerId = 1;
  return ev;
}

export function fire(el: EventTarget, ev: Event): void {
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** Seed a note through the test-mode App hook and return its id. */
export function seed(x: number, y: number, color?: string): string {
  const w = window as unknown as { __vidi6: { seedSticky(x: number, y: number, c?: string): string } };
  let id = '';
  act(() => {
    id = w.__vidi6.seedSticky(x, y, color);
  });
  return id;
}

export function boardState(): { selectedId: string | null; editingId: string | null } {
  const w = window as unknown as { __vidi6: { getState(): { selectedId: string | null; editingId: string | null } } };
  return w.__vidi6.getState();
}

/** Press a key on `target`. Returns true when the board called preventDefault
 * (i.e. the key was consumed and the browser must not scroll / select text). */
export function pressKey(key: string, target: EventTarget = window, init: KeyboardEventInit = {}): boolean {
  let prevented = false;
  act(() => {
    prevented = !target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
  return prevented;
}

/** The whole selection (story 7), through the test-mode App hook. */
export function selectionIds(): string[] {
  const w = window as unknown as { __vidi6: { selectedIds(): string[] } };
  return w.__vidi6.selectedIds();
}

// --- animation frames --------------------------------------------------------
//
// The transform gesture and the marquee coalesce their writes and repaints into
// animation frames (at most one write transaction per frame). jsdom's
// requestAnimationFrame is a real timer a test would have to wait for, so the
// harness replaces it with a queue: a test says "a frame passed" and nothing
// happens on its own, which also makes "two moves, one frame, one write" testable.

type Frame = (t: number) => void;
const frameQueue = new Map<number, Frame>();
let frameSeq = 1;

export function installFrameQueue(): void {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = frameSeq++;
    frameQueue.set(id, cb as Frame);
    return id;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    frameQueue.delete(id);
  }) as typeof globalThis.cancelAnimationFrame;
}

/** Run what the board queued for the next animation frame (once per call). */
export function flushFrame(times = 1): void {
  for (let i = 0; i < times; i++) {
    const batch = [...frameQueue.values()];
    frameQueue.clear();
    act(() => {
      for (const cb of batch) cb(Date.now());
    });
  }
}

/** How many frames are waiting (a coalescing test asserts this is 1). */
export function pendingFrames(): number {
  return frameQueue.size;
}

/** Forget queued frames (called between tests). */
export function clearFrames(): void {
  frameQueue.clear();
}

// --- story 7 helpers ---------------------------------------------------------

/** A snapshot row. Story 7 objects always carry their size (a note without a
 * persisted size renders — and transforms — at STICKY_SIZE_WORLD), so tests can
 * read width and height as plain numbers. */
export interface Row {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

/** Every object on the board, in stacking order. */
export function rows(): Row[] {
  const w = window as unknown as { __vidi6: { snapshot(): Row[] } };
  return w.__vidi6.snapshot();
}

export function row(id: string): Row {
  const found = rows().find((r) => r.id === id);
  if (!found) throw new Error(`object ${id} is gone`);
  return found;
}

/** The board's Y.Doc, through the test hook (seeding and "someone else did it"
 * deletes go straight to the document). */
export function testDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

/** Plant a testbox (the test-only registered object type) at an exact rect. */
export function seedBox(rect: Rect & { z?: number }): string {
  const doc = testDoc();
  let id = '';
  act(() => {
    id = createTestbox(doc, rect);
  });
  return id;
}

/** Delete objects the way a remote edit does: straight to the document. */
export function deleteThroughDoc(ids: string[]): void {
  const doc = testDoc();
  act(() => {
    for (const id of ids) deleteObject(doc, id);
  });
}

/** The element of a seeded note, or of a testbox. */
export function objectEl(id: string): HTMLElement {
  const el =
    document.querySelector<HTMLElement>(`[data-note-id="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-obj-id="${id}"]`);
  if (!el) throw new Error(`object ${id} is not rendered`);
  return el;
}

/** The board's background (a press on it pans, or starts the marquee). */
export function viewport(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (!el) throw new Error('board viewport not rendered');
  return el;
}

/** The board camera. */
export function cameraState(): { x: number; y: number; zoom: number } {
  const w = window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } };
  return w.__vidi6.getCamera();
}

/** World → screen coordinates. The camera is NOT identity (the first view centres
 * the world origin in the viewport), so a gesture that starts from a world rect —
 * the marquee above all — converts through the board's own camera. */
export function clientOf(x: number, y: number): { x: number; y: number } {
  const w = window as unknown as {
    __vidi6: { worldToScreen(p: { x: number; y: number }): { x: number; y: number } };
  };
  return w.__vidi6.worldToScreen({ x, y });
}

/** Shift+drag on the background from one world rect corner to another, drawing the
 * box (one repaint per frame) and committing it. */
export function marqueeToWorldCorner(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const a = clientOf(from.x, from.y);
  const b = clientOf(to.x, to.y);
  const vp = viewport();
  fire(vp, pointerEvent('pointerdown', a.x, a.y, { shiftKey: true }));
  flushFrame();
  fire(window, pointerEvent('pointermove', b.x, b.y));
  flushFrame();
  fire(window, pointerEvent('pointerup', b.x, b.y));
  flushFrame();
}

/** Select objects through the selection state (what a click would do). */
export function selectThroughHook(id: string | null): void {
  const w = window as unknown as { __vidi6: { select(id: string | null): void } };
  act(() => w.__vidi6.select(id));
}

/** Click an object (press and release with no movement). */
export function clickObject(id: string, at?: { x: number; y: number }): void {
  const el = objectEl(id);
  const r = row(id);
  const p = at ?? { x: r.x + 10, y: r.y + 10 };
  fire(el, pointerEvent('pointerdown', p.x, p.y));
  fire(el, pointerEvent('pointerup', p.x, p.y));
}

/** Shift-click an object. */
export function shiftClickObject(id: string): void {
  const el = objectEl(id);
  const r = row(id);
  const p = { x: r.x + 10, y: r.y + 10 };
  fire(el, pointerEvent('pointerdown', p.x, p.y, { shiftKey: true }));
  fire(el, pointerEvent('pointerup', p.x, p.y, { shiftKey: true }));
}