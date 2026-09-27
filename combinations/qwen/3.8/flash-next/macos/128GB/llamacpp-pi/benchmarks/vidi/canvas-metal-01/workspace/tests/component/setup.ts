// jsdom setup for component tests: the few browser APIs jsdom does not implement
// that the board viewport depends on.
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/** The board area reports this fixed size to anything that measures it. */
export const VIEWPORT_SIZE = { width: 1280, height: 800 };

// --- Layout ----------------------------------------------------------------
// jsdom has no layout: every element is 1280x800 at the origin, which matches the
// e2e fixtures and makes camera maths predictable in tests.
Element.prototype.getBoundingClientRect =
  function getBoundingClientRect(): DOMRect {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: VIEWPORT_SIZE.width,
      bottom: VIEWPORT_SIZE.height,
      width: VIEWPORT_SIZE.width,
      height: VIEWPORT_SIZE.height,
    };
    return {
      ...rect,
      toJSON: () => rect,
    } as DOMRect;
  };

// --- ResizeObserver --------------------------------------------------------
class ResizeObserverStub implements ResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.targets.add(target);
    // Deliver an initial observation asynchronously, like the real thing.
    queueMicrotask(() => {
      if (!this.targets.has(target)) return;
      this.callback([entryFor(target)], this);
    });
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }
}

function entryFor(target: Element): ResizeObserverEntry {
  const width = VIEWPORT_SIZE.width;
  const height = VIEWPORT_SIZE.height;
  return {
    target,
    contentRect: {
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    },
    borderBoxSize: [{ blockSize: height, inlineSize: width }],
    contentBoxSize: [{ blockSize: height, inlineSize: width }],
    devicePixelContentBoxSize: [{ blockSize: height, inlineSize: width }],
  } as unknown as ResizeObserverEntry;
}

globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// --- Pointer events --------------------------------------------------------
// jsdom ships no PointerEvent, and no pointer capture.
// Structural stand-in (cast when registered below): jsdom's MouseEvent lacks the
// pointer members, and its own PointerEvent does not exist in this jsdom version.
class PointerEventStub extends MouseEvent {
  readonly altKey: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly height: number;
  readonly hydrate: unknown = undefined;
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly width: number;

  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params);
    this.altKey = params.altKey ?? false;
    this.button = params.button ?? 0;
    this.buttons = params.buttons ?? 0;
    this.clientX = params.clientX ?? 0;
    this.clientY = params.clientY ?? 0;
    this.ctrlKey = params.ctrlKey ?? false;
    this.metaKey = params.metaKey ?? false;
    this.shiftKey = params.shiftKey ?? false;
    this.height = params.height ?? 0;
    this.isPrimary = params.isPrimary ?? true;
    this.pointerId = params.pointerId ?? 1;
    this.pointerType = params.pointerType ?? "mouse";
    this.pressure = params.pressure ?? 0;
    this.tangentialPressure = params.tangentialPressure ?? 0;
    this.tiltX = params.tiltX ?? 0;
    this.tiltY = params.tiltY ?? 0;
    this.twist = params.twist ?? 0;
    this.width = params.width ?? 0;
  }

  get layerX(): number {
    return this.clientX;
  }

  get layerY(): number {
    return this.clientY;
  }

  get pageX(): number {
    return this.clientX;
  }

  get pageY(): number {
    return this.clientY;
  }

  cancelBubble = false;
  relatedTarget: EventTarget | null = null;
  srcElement: Element | null = null;
}

globalThis.PointerEvent ??= PointerEventStub as unknown as typeof PointerEvent;

Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
