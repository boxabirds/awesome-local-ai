// jsdom does not implement ResizeObserver or PointerEvent capture; provide
// inert stand-ins so BoardViewport can run in component tests.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals`, so Testing Library's auto-cleanup never
// hooks into a global afterEach; do it explicitly.
afterEach(() => {
  cleanup();
});

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverMock,
  configurable: true,
  writable: true,
});

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(this: Element): void {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function releasePointerCapture(this: Element): void {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(this: Element): boolean {
    return false;
  };
}

// Story 5: jsdom has no fetch. Answer the board API by default so the board
// page's existence check (GET /api/boards/:id) succeeds and the board
// mounts. Tests override with vi.stubGlobal('fetch', ...) when a test needs
// a 404 (share.check retries) or a creation (POST /api/boards).
const VALID_BOARD_ID = 'a'.repeat(22);
function apiResponse(
  url: string,
  method: string,
): Response | null {
  if (method === 'POST' && url === '/api/boards') {
    return new Response(JSON.stringify({ id: VALID_BOARD_ID }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const match = url.match(/^\/api\/boards\/([^/]+)$/);
  if (method === 'GET' && match !== null) {
    return new Response(JSON.stringify({ id: match[1] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// Always installed (not just when absent): Node 18+ ships a real global
// fetch, which would try the network for the relative /api/boards URLs.
Object.defineProperty(globalThis, 'fetch', {
  value: (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = typeof input === 'object' && 'method' in input ? input.method : 'GET';
    const res = apiResponse(url, method);
    if (res !== null) return Promise.resolve(res);
    return Promise.reject(new Error(`mock fetch: unhandled ${method} ${url}`));
  },
  configurable: true,
  writable: true,
});
