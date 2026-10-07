// Global type declarations for Safari-style gesture events (non-standard DOM events)
declare global {
  interface GestureEvent {
    scale: number;
    rotation: number;
  }

  // Extend HTMLElementEventMap with gesture events
  interface HTMLElementEventMap {
    gesturestart: Event;
    gesturechange: Event;
  }

  // Extend HTMLDivElementEventMap with gesture events
  interface HTMLDivElementEventMap {
    gesturestart: Event;
    gesturechange: Event;
  }
}

export {};

// Module augmentation for React to support gesture event props on div elements
import 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface DOMAttributes<T> {
    onGestureStart?: ((event: Event) => void) | undefined;
    onGestureChange?: ((event: Event) => void) | undefined;
  }
}
