/**
 * ResizeObserver stub for jsdom (it has none). Tests read the board size from
 * OBSERVED_SIZE and can change it with setObservedSize to simulate a window resize.
 */
import type { Size } from '../../src/client/canvas/camera';

type Callback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

interface Registration {
  callback: Callback;
  element: Element;
}

const registrations = new Set<Registration>();
const observedSize = { width: 1280, height: 800 };

export function fakeEntry(element: Element, size: Size): ResizeObserverEntry {
  return {
    target: element,
    contentRect: {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: size.width,
      bottom: size.height,
      width: size.width,
      height: size.height,
      toJSON: () => ({}),
    },
    borderBoxSize: [{ boxSize: size, inlineSize: size.width, blockSize: size.height }],
    contentBoxSize: [{ boxSize: size, inlineSize: size.width, blockSize: size.height }],
    devicePixelContentBoxSize: [],
  } as unknown as ResizeObserverEntry;
}

export class ResizeObserverStub {
  private readonly callback: Callback;

  constructor(callback: Callback) {
    this.callback = callback;
  }

  observe(element: Element): void {
    const registration: Registration = { callback: this.callback, element };
    registrations.add(registration);
    this.callback([fakeEntry(element, observedSize)], this as unknown as ResizeObserver);
  }

  unobserve(element: Element): void {
    for (const registration of registrations) {
      if (registration.element === element) {
        registrations.delete(registration);
      }
    }
  }

  disconnect(): void {
    registrations.clear();
  }
}

/** Change the size reported to every live ResizeObserver (a window resize). */
export function setObservedSize(size: Size): void {
  observedSize.width = size.width;
  observedSize.height = size.height;
  for (const registration of [...registrations]) {
    registration.callback([fakeEntry(registration.element, size)], null as never);
  }
}

export function installResizeObserver(): void {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
    writable: true,
  });
}
