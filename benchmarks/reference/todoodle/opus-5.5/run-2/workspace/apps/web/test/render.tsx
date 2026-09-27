import type { Workspace } from '@todoodle/shared/schemas';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { expect, vi } from 'vitest';
import { AppProviders, AppRoutes } from '@/App';
import { rememberSecretWorkspace } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { resetHoverNoneForTests } from '@/lib/useHoverNone';
import { server } from './msw';

export type Entry = { pathname: string; hash?: string; state?: unknown };

/** Exposes the router location to assertions. */
export const currentLocation: { value?: ReturnType<typeof useLocation> } = {};

function LocationSpy() {
  currentLocation.value = useLocation();
  return null;
}

/**
 * Renders the app at `entry` inside an awaited act(): React 19 does not retry a component that
 * suspended (use() on the open promise) inside a synchronous act scope.
 */
export async function renderApp(entry: Entry, extra?: ReactNode): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = renderAppSync(entry, extra);
  });
  return result;
}

function renderAppSync(entry: Entry, extra?: ReactNode) {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[{ pathname: entry.pathname, hash: entry.hash ?? '', state: entry.state }]}>
        <AppRoutes />
        <LocationSpy />
        {extra}
      </MemoryRouter>
    </AppProviders>,
  );
}

/** The state right after a successful create: cache primed and the secret known in memory. */
export function primeCreated(ws: Workspace, secret: string) {
  queryClient.setQueryData(queryKeys.workspace(ws.id), ws);
  rememberSecretWorkspace(secret, ws.id);
}

export type ClipboardStub = {
  writeText?: ReturnType<typeof vi.fn>;
  write?: ReturnType<typeof vi.fn>;
};

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** Replaces navigator.clipboard (undefined = no clipboard API at all). */
export function stubClipboard(stub: ClipboardStub | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => stub });
}

export function restoreClipboard() {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function titleText(): string | null {
  const titles = [...document.head.querySelectorAll('title')];
  return titles.length ? titles[0]!.textContent : null;
}

/** Opens a Radix DropdownMenu from its trigger (Radix opens on a primary-button pointerdown). */
export async function openMenu(trigger: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
}

/** Counts requests matching method + path pattern (MSW life-cycle events, handlers untouched). */
export function countRequests(method: string, pattern: RegExp): { readonly count: number } {
  const counter = { count: 0 };
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && pattern.test(new URL(request.url).pathname)) counter.count++;
  });
  return counter;
}

/** Stubs matchMedia so '(hover: none)' reports `hoverNone`. Call before rendering. */
export function stubHoverNone(hoverNone: boolean) {
  resetHoverNoneForTests();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(hover: none)' ? hoverNone : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/**
 * axe-core on the page, or on an open dialog (while a modal is open the page behind it is
 * aria-hidden on purpose, and Radix's focus guards are aria-hidden too). Colour contrast is covered
 * by the token contrast unit test.
 */
export async function expectNoAxeViolations(node: Element = document.body) {
  const results = await axe.run(node, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
