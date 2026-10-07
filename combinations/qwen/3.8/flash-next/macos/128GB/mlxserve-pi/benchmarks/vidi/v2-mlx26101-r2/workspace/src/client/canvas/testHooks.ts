import type { Camera } from './camera.js';
import type { ConnectionState } from '../sync/connectBoard.js';
import type { ObjectSnapshot } from '../../shared/board-model.js';
import type { Point, Rect } from '../../shared/geometry.js';
import type { ShapeKind } from '../../shared/objects/shape.js';
import type { Endpoint } from '../../shared/objects/connector.js';
import type * as Y from 'yjs';

/**
 * Test-only hook for jumping the camera around the board. Dragging a million
 * pixels in an e2e test is impractical, so e2e teleports instead
 * (design "Fixtures"). Registered only when `import.meta.env.MODE === 'test'`
 * (i.e. `vite build --mode test`); the condition is a build-time constant so
 * dead-code elimination removes this from production builds.
 */
export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /**
   * The connection state the badge is showing, or null before the board has one
   * (design "sync.client": e2e asserts the badge text and this).
   */
  connectionState: ConnectionState | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/** The last connection state published, so a later registration keeps it. */
let connectionState: ConnectionState | null = null;

export function registerTestHooks(api: Vidi6TestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  api.connectionState = connectionState;
  window.__vidi6 = api;
}

/**
 * Record the connection state for e2e assertions (TC-29 reads it on an idle
 * connection). Only the test build keeps it.
 */
export function publishConnectionState(state: ConnectionState): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  connectionState = state;
  if (window.__vidi6) window.__vidi6.connectionState = state;
}

export function clearTestHooks(): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  delete window.__vidi6;
}

export function testHooks(): Vidi6TestHooks | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__vidi6;
}

/**
 * Test-only view of the board document, so tests can assert the document state
 * directly (and delete a note "via a model call", as the design's TC-37 puts
 * it) instead of only through the rendered DOM.
 */
export interface Vidi6BoardTestHooks {
  getDoc(): Y.Doc | undefined;
  getNotes(): readonly ObjectSnapshot[];
  /** The board this page is on, from the URL. */
  getBoardId(): string;
  /**
   * Story 10's model calls, so a fixture can put shapes and arrows on a board
   * before a test starts acting (`tests/fixtures/checkout-flow.ts`).
   *
   * A page cannot `import` the app's modules into `page.evaluate`, and writing the
   * `objects` fields by hand would be a fixture that *describes* content instead of
   * one that writes it. So these are the app's own functions - the ones the Shape
   * tool and the Connector tool call - bound to this page's document, which is the
   * only document there is and so is left out of the arguments. Like everything in
   * this file they exist only in the test build; the shapes they write are the
   * shapes a person would have drawn, colours, `z` and all.
   */
  createShape(input: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean }, by: string): string | null;
  setShapeStyle(id: string, style: { fill?: string; stroke?: string }): boolean;
  /** A shape's label, as the `Y.Text` it is: the fixture writes into it directly. */
  shapeLabel(id: string): Y.Text | undefined;
  createConnector(from: Endpoint, to: Endpoint, by: string): string | null;
}

declare global {
  interface Window {
    __vidi6Board?: Vidi6BoardTestHooks;
  }
}

export function registerBoardTestHooks(hooks: Vidi6BoardTestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  window.__vidi6Board = hooks;
}

export function clearBoardTestHooks(): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  delete window.__vidi6Board;
}

export function boardTestHooks(): Vidi6BoardTestHooks | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__vidi6Board;
}

/**
 * Test-only controls for the board's own connection (design "Flaky Wi-Fi",
 * TC-27). Playwright's `context.setOffline(true)` does not interrupt a
 * WebSocket that is already open - it only makes new connections fail - so a
 * test that wants an outage says "the connection dropped" here and holds the
 * *reconnection* offline with `setOffline`. Both are the provider's own
 * `disconnect()`/`connect()`; nothing else about the connection changes.
 */
export interface Vidi6ConnectionTestHooks {
  /** Hang up the socket. The provider retries on its own backoff. */
  dropConnection(): void;
  /** Retry now, instead of waiting for the backoff. */
  restoreConnection(): void;
}

declare global {
  interface Window {
    __vidi6Connection?: Vidi6ConnectionTestHooks;
  }
}

let connectionHooks: Vidi6ConnectionTestHooks | null = null;

export function registerConnectionTestHooks(hooks: Vidi6ConnectionTestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  connectionHooks = hooks;
  window.__vidi6Connection = hooks;
}

/** Unregister, but only if this is still the connection that owns the slot. */
export function clearConnectionTestHooks(hooks: Vidi6ConnectionTestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  if (connectionHooks !== hooks) return;
  connectionHooks = null;
  delete window.__vidi6Connection;
}
