// jsdom is missing some browser APIs the board viewport uses. Stub them so
// component tests can run in jsdom.

import '@testing-library/jest-dom/vitest';

if (typeof Element !== 'undefined') {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
}

// jsdom has no PointerEvent; without one, testing-library's createEvent
// falls back to `new Event(...)` which drops clientX/button/pointerId from
// the init dictionary. Provide a minimal PointerEvent built on MouseEvent
// (which honours clientX/clientY/button) plus the pointer-specific fields.
interface PointerEventInit extends MouseEventInit {
  pointerId?: number;
  pointerType?: string;
}

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly pressure: number;
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly twist: number;
  readonly tangentialPressure: number;
  readonly gravity: number;
  readonly height: number;
  readonly width: number;
  readonly isPrimary: boolean;
  readonly tiltX: number;
  readonly tiltY: number;

  getCoalescedEvents(): PointerEvent[] {
    return [];
  }

  getPredictedEvents(): PointerEvent[] {
    return [];
  }

  constructor(type: string, init: PointerEventInit & { pressure?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
    this.pressure = init.pressure ?? 0;
    this.altitudeAngle = 0;
    this.azimuthAngle = 0;
    this.twist = 0;
    this.tangentialPressure = 0;
    this.gravity = 0;
    this.height = 0;
    this.width = 0;
    this.isPrimary = true;
    this.tiltX = 0;
    this.tiltY = 0;
  }
}

if (typeof window !== 'undefined' && !window.PointerEvent) {
  (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
    PointerEventPolyfill;
}
