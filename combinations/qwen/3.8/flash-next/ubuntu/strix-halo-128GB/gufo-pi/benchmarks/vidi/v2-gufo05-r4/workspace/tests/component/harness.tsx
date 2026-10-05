/**
 * Shared helpers for the jsdom component tests.
 *
 * jsdom has no layout and no pointer capture, so the board area is reported as
 * a fixed laptop viewport and gestures are dispatched as real events
 * (PointerEvent/WheelEvent/KeyboardEvent) through React's root listener.
 */

import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { Camera, Size } from '../../src/client/canvas/camera';

export const VIEWPORT_SIZE: Size = { width: 1280, height: 800 };
export const CENTRE = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };

/** The size jsdom pretends the board area has; change it with resizeBoardArea. */
let boardAreaSize: Size = { ...VIEWPORT_SIZE };

function rectFor(size: Size): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: size.width,
    bottom: size.height,
    width: size.width,
    height: size.height,
    toJSON: () => ({})
  } as DOMRect;
}

/** Make every element report the board area size, as real layout would. */
export function stubViewportGeometry(): void {
  boardAreaSize = { ...VIEWPORT_SIZE };
  Element.prototype.getBoundingClientRect = () => rectFor(boardAreaSize);
}

const observers = new Set<ResizeObserverStub>();

/** A ResizeObserver that reports the current size as soon as it observes. */
class ResizeObserverStub implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.callback([{ target, contentRect: rectFor(boardAreaSize) } as unknown as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {
    observers.delete(this);
  }
  trigger(): void {
    this.callback(
      [{ target: document.body, contentRect: rectFor(boardAreaSize) } as unknown as ResizeObserverEntry],
      this
    );
  }
}

export function stubResizeObserver(): void {
  observers.clear();
  class TrackedResizeObserver extends ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      observers.add(this);
    }
  }
  vi.stubGlobal('ResizeObserver', TrackedResizeObserver);
}

/** Grow or shrink the board area, as dragging a browser window would. */
export async function resizeBoardArea(size: Size): Promise<void> {
  boardAreaSize = size;
  await act(async () => {
    for (const observer of [...observers]) observer.trigger();
  });
}

/** The camera the board is currently showing (test hook, installed in test mode). */
export function testCamera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('window.__vidi6 test hooks are not installed');
  return hooks.getCamera();
}

/** Jump the camera somewhere without dragging a million pixels. */
export async function setTestCamera(camera: Camera): Promise<void> {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('window.__vidi6 test hooks are not installed');
  hooks.setCamera(camera);
  await flushCameraFrame();
}

/** Let the requestAnimationFrame-coalesced camera update land. */
export async function flushCameraFrame(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(32);
  });
}

/** Run a synchronous interaction inside React's act(). */
export function interact(fn: () => void): void {
  act(() => {
    fn();
  });
}

interface PointerOptions {
  pointerId?: number;
  button?: number;
  shiftKey?: boolean;
}

/** Dispatch a pointer event (jsdom supports PointerEvent). */
export function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  clientX: number,
  clientY: number,
  options: PointerOptions = {}
): Event {
  const init = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    buttons: type === 'pointerdown' ? 1 : type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    isPrimary: true,
    pointerType: 'mouse',
    shiftKey: options.shiftKey ?? false
  };
  const event = new PointerEvent(type, init);
  interact(() => {
    target.dispatchEvent(event);
  });
  return event;
}

interface WheelOptions {
  ctrlKey?: boolean;
  metaKey?: boolean;
  deltaMode?: number;
}

export function fireWheel(
  target: Element,
  clientX: number,
  clientY: number,
  deltaX: number,
  deltaY: number,
  options: WheelOptions = {}
): Event {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaX,
    deltaY,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false
  });
  interact(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Safari's GestureEvent does not exist outside Safari; fake its few fields. */
export function fireGesture(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  clientX?: number,
  clientY?: number
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, rotation: 0 });
  if (clientX !== undefined && clientY !== undefined) {
    Object.assign(event, { clientX, clientY });
  }
  interact(() => {
    target.dispatchEvent(event);
  });
  return event;
}

export function fireKey(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: EventTarget } = {}
): Event {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false
  });
  interact(() => {
    (options.target ?? window).dispatchEvent(event);
  });
  return event;
}

/**
 * Run the pending animation frames, which is how a dragged note gets its
 * throttled position writes (one per frame), and let React settle afterwards.
 */
export async function flushFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(16);
      else await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Type into an element the way a browser does: set the value, then `input`. */
export function fireInput(element: Element, value: string): void {
  const input = element as HTMLTextAreaElement;
  input.value = value;
  interact(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Paste `text` at the end of the caret, the way a browser inserts it. */
export function firePaste(element: Element, text: string): void {
  const input = element as HTMLTextAreaElement;
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', {
    value: { getData: (kind: string) => (kind === 'text/plain' ? text : '') }
  });
  interact(() => {
    input.dispatchEvent(paste);
  });
  // The component prevented the default: it inserted the text itself.
  if (!paste.defaultPrevented) fireInput(element, `${input.value}${text}`);
}

/**
 * An input-method commit: `provisional` appears under the caret, then the method
 * replaces it with `committed` (what a Japanese or Chinese keyboard does). The
 * component must end up with `before + committed` and nothing of the provisional
 * text left over.
 */
export function fireComposition(
  element: Element,
  before: string,
  provisional: string,
  committed: string
): void {
  const input = element as HTMLTextAreaElement;
  interact(() => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = `${before}${provisional}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: provisional })
    );
  });
  interact(() => {
    input.value = `${before}${committed}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: committed }));
  });
}

/** Every sticky note on screen, in the order the document draws them. */
export function stickyNotes(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-vidi6="sticky"]'));
}

/** Every note's stored position, as rendered into the world layer. */
export function stickyPositions(root: HTMLElement): { x: number; y: number }[] {
  return stickyNotes(root).map((note) => ({
    x: Number(note.dataset.x),
    y: Number(note.dataset.y)
  }));
}

/** The nth sticky note, failing loudly when there is no such note. */
export function stickyNote(root: HTMLElement, index: number): HTMLElement {
  const notes = stickyNotes(root);
  const note = notes[index];
  if (!note) throw new Error(`no sticky note at index ${index} (there are ${notes.length})`);
  return note;
}

/** The text a note displays (the note must not be being edited). */
export function stickyNoteText(root: HTMLElement, index: number): string {
  return stickyNote(root, index).querySelector('[data-testid="sticky-text"]')?.textContent ?? '';
}

/** The textarea of the note currently being edited. */
export function stickyEditor(root: HTMLElement): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>('[data-testid="sticky-input"]');
}

/** The floating toolbar of a note, or null when it is not shown. */
export function noteToolbar(note: HTMLElement): HTMLElement | null {
  return note.querySelector<HTMLElement>('[data-vidi6="note-toolbar"]');
}

/** A colour swatch in a note's toolbar, by colour name. */
export function noteSwatch(note: HTMLElement, colour: string): HTMLElement | null {
  return note.querySelector<HTMLElement>(`[data-vidi6="note-swatch"][data-color="${colour}"]`);
}

/** The delete button of a note's toolbar. */
export function noteDeleteButton(note: HTMLElement): HTMLElement | null {
  return note.querySelector<HTMLElement>('[data-vidi6="note-delete"]');
}

/** The note's overflow fade, or null when its text fits. */
export function stickyFade(root: HTMLElement, index: number): HTMLElement | null {
  return stickyNote(root, index).querySelector<HTMLElement>('[data-testid="sticky-fade"]');
}

/** The character counter of the note being edited. */
export function stickyCounter(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="sticky-counter"]');
}

/** The sticky note tool in the toolbar on the left of the screen. */
export function stickyToolButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector<HTMLElement>('[data-vidi6="tool-sticky"]');
  if (!button) throw new Error('the toolbar has no sticky note tool');
  return button;
}

/** Click a plain element (mouse pointer, primary button, down then up). */
export function clickElement(element: Element): void {
  firePointer(element, 'pointerdown', 0, 0);
  firePointer(element, 'pointerup', 0, 0);
  interact(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Double-click an element the way a browser does. */
export function doubleClick(element: Element, clientX = 0, clientY = 0): void {
  firePointer(element, 'pointerdown', clientX, clientY);
  firePointer(element, 'pointerup', clientX, clientY);
  interact(() => {
    element.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX, clientY, button: 0 })
    );
  });
}

/** Read the world layer's CSS transform, which is how the board is positioned. */
export function worldTransform(container: HTMLElement): string {
  const world = container.querySelector<HTMLElement>('[data-vidi6="world"]');
  if (!world) throw new Error('world layer not found');
  return world.style.transform;
}

/** The transform string the board is expected to render for a camera. */
export function expectedWorldTransform(camera: Camera): string {
  return `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}

/** Grid background geometry, which is how the dot grid is positioned. */
export function gridBackground(container: HTMLElement): { size: string; position: string } {
  const viewport = container.querySelector<HTMLElement>('[data-vidi6="viewport"]');
  if (!viewport) throw new Error('viewport not found');
  return { size: viewport.style.backgroundSize, position: viewport.style.backgroundPosition };
}

export function viewportElement(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector<HTMLElement>('[data-vidi6="viewport"]');
  if (!viewport) throw new Error('viewport not found');
  return viewport;
}

export function byTestId(container: HTMLElement, testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}
