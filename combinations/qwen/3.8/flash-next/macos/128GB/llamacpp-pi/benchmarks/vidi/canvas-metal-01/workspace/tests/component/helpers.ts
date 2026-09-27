// Shared helpers for the component tests.
import { act } from "@testing-library/react";

import type { Camera } from "../../src/client/canvas/camera";

/** Board area size the jsdom stub reports for any measured element. */
export const VIEWPORT_SIZE = { width: 1280, height: 800 };

/** Let camera updates coalesced onto an animation frame land, inside act(). */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 20);
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The camera the rendered board currently advertises (mirrored on data attributes). */
export function readCamera(el: Element): Camera {
  const source = el.hasAttribute("data-camera-x")
    ? el
    : (el.querySelector("[data-camera-x]") ?? el);
  return {
    x: Number(source.getAttribute("data-camera-x")),
    y: Number(source.getAttribute("data-camera-y")),
    zoom: Number(source.getAttribute("data-camera-zoom")),
  };
}

export interface WheelOptions {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  clientX?: number;
  clientY?: number;
}

/** Dispatch a cancelable wheel event and return it so `defaultPrevented` can be read. */
export function dispatchWheel(el: Element, options: WheelOptions): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  el.dispatchEvent(event);
  return event;
}

/**
 * Dispatch a Safari-style gesture event (non-standard, so constructed by hand).
 * `scale` is the total pinch scale since gesturestart.
 */
export function dispatchGesture(
  el: Element,
  type: string,
  scale: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "scale", { value: scale });
  Object.defineProperty(event, "clientX", { value: VIEWPORT_SIZE.width / 2 });
  Object.defineProperty(event, "clientY", { value: VIEWPORT_SIZE.height / 2 });
  el.dispatchEvent(event);
  return event;
}

/** Dispatch a cancelable keydown on window. */
export function dispatchKey(
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}
