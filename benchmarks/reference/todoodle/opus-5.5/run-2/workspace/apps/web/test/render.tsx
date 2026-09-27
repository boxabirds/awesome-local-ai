import type { Workspace } from '@todoodle/shared/schemas';
import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import { AppProviders, AppRoutes } from '@/App';
import { rememberSecretWorkspace } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

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
