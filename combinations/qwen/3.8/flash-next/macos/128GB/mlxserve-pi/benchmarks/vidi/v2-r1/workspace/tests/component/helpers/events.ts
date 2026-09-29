import { fireEvent } from '@testing-library/react';

/** Viewport the component tests run in (matches setup.ts). */
export const VIEWPORT = { width: 1280, height: 800 };

type PointerType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'lostpointercapture';

interface PointerOptions {
  pointerId?: number;
  button?: number;
}

/**
 * jsdom implements neither PointerEvent nor pointer capture, so build a plain
 * bubbling event carrying the properties React's synthetic pointer events read
 * (clientX/clientY from the MouseEvent interface, pointerId/pointerType/isPrimary
 * from the PointerEvent interface).
 */
export function dispatchPointer(
  element: Element,
  type: PointerType,
  x: number,
  y: number,
  options: PointerOptions = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const pressed = type === 'pointerdown' || type === 'pointermove';
  Object.assign(event, {
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    pageX: x,
    pageY: y,
    offsetX: x,
    offsetY: y,
    pointerId: options.pointerId ?? 1,
    pointerType: 'mouse',
    width: 1,
    height: 1,
    pressure: pressed ? 0.5 : 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    altitudeAngle: 0,
    azimuthAngle: 0,
    button: options.button ?? 0,
    buttons: pressed ? 1 : 0,
    isPrimary: true,
    detail: 0,
    view: window,
  });
  fireEvent(element, event);
  return event;
}

/** Dispatch a wheel event (jsdom does implement WheelEvent). */
export function dispatchWheel(
  element: Element,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(element, event);
  return event;
}

/** Safari GestureEvent: not implemented anywhere, so carry scale by hand. */
export function dispatchGesture(
  element: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  x: number,
  y: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: x, clientY: y });
  fireEvent(element, event);
  return event;
}
