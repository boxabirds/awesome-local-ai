import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Counts, Task } from '@todoodle/shared/schemas';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { type CreateOutcome, countsHandler, createHandler, listHandler } from '../msw/tasks.ts';
import { WORKSPACE, getHandler } from './fixtures.ts';
import { renderApp } from './render.tsx';

export const ID = WORKSPACE.id;
export const INBOX_KEY = queryKeys.tasks(ID, { list: 'inbox' });
export const COUNTS_KEY = queryKeys.counts(ID);

type EnterOpts = {
  tasks?: Task[];
  counts?: Counts;
  listStatus?: number;
  listUntil?: Promise<unknown>;
  countsUntil?: Promise<unknown>;
  create?: CreateOutcome[];
  createUntil?: Promise<unknown>;
  bodies?: unknown[];
};

/** /w/:id with the Inbox served by MSW (schema-parsed fixtures). Resolves once the Inbox heading shows. */
export async function enterInbox(opts: EnterOpts = {}) {
  const tasks = opts.tasks ?? [];
  server.use(
    getHandler(),
    listHandler({ tasks, status: opts.listStatus, until: opts.listUntil }),
    countsHandler({ counts: opts.counts ?? { inbox: tasks.length }, until: opts.countsUntil }),
    createHandler({ outcomes: opts.create, until: opts.createUntil, bodies: opts.bodies }),
  );
  // The link counts as saved, so story 2's unsaved-link banner stays out of the way.
  localStorage.setItem(`tdl:v1:linkSaved:${ID}`, '1');
  const rendered = await renderApp(`/w/${ID}`);
  await screen.findByRole('heading', { name: 'Inbox', level: 1 });
  return rendered;
}

/** Renders a component with the app's query client (no router). */
export async function renderWithClient(ui: ReactNode) {
  const user = userEvent.setup();
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  });
  return { user, ...result };
}

export function rows(): HTMLElement[] {
  return screen.queryAllByRole('option');
}

export function rowNames(): string[] {
  return rows().map((row) => row.querySelector('p')?.textContent ?? '');
}

export function inboxCount(): number | undefined {
  return queryClient.getQueryData<Counts>(COUNTS_KEY)?.inbox;
}

/** Stubs matchMedia for a viewport width and pointer (the D6 classes); happy-dom has no layout engine. */
export function setViewport({ width, coarse = false }: { width: number; coarse?: boolean }) {
  const listeners = new Set<() => void>();
  const matches = (query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    if (max && width > Number(max[1])) return false;
    if (min && width < Number(min[1])) return false;
    if (/hover:\s*none/.test(query)) return coarse;
    if (/pointer:\s*coarse/.test(query)) return coarse;
    return true;
  };
  // vi.stubGlobal: restored by vi.unstubAllGlobals() after each test (test/setup.ts).
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  }));
  return {
    /** Changes the width and notifies subscribers, as a real resize would. */
    resize(next: number) {
      width = next;
      for (const cb of [...listeners]) cb();
    },
  };
}
