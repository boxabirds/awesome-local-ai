import { screen, within } from '@testing-library/react';
import type { Task } from '@todoodle/shared/schemas';
import { vi } from 'vitest';
import { server } from '../msw.ts';
import { makeTask } from '../msw/tasks.ts';
import type { TodayServer } from '../msw/todayServer.ts';
import { getHandler } from './fixtures.ts';
import { renderApp } from './render.tsx';
import { ID } from './tasks.tsx';

export { ID };

/** Story 8 UI tests run on Fri 2026-09-25 (local), 09:00. */
export const FRIDAY = new Date(2026, 8, 25, 9, 0, 0);
export const TODAY = '2026-09-25';

/**
 * The fake clock every story 8 UI test uses: Date (and, with `timers`, setTimeout) faked at Fri 2026-09-25 09:00,
 * advancing with real time so MSW and waitFor keep working. Labels are en-GB ('Fri 25 Sep').
 */
export function useFriday({ timers = false }: { timers?: boolean } = {}) {
  vi.useFakeTimers({ toFake: timers ? ['setTimeout', 'clearTimeout', 'Date'] : ['Date'], shouldAdvanceTime: true, now: FRIDAY });
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
}

/** A task with a due date (and optionally a project). */
export function dated(name: string, dueDate: string | null, index: number, fields: Partial<Task> = {}): Task {
  return makeTask({ name, dueDate, ...fields }, index);
}

/** Opens `path` (Today by default) with the stateful Today server. Resolves once the view heading shows. */
export async function enterToday(api: TodayServer, path = `/w/${ID}/today`, heading = 'Today') {
  server.use(getHandler(), ...api.handlers);
  localStorage.setItem(`tdl:v1:linkSaved:${ID}`, '1');
  const rendered = await renderApp(path);
  await screen.findByRole('heading', { name: heading, level: 1 });
  return rendered;
}

export function overdueRows(): HTMLElement[] {
  const list = screen.queryByRole('listbox', { name: 'Overdue tasks' });
  return list ? within(list).queryAllByRole('option') : [];
}

export function todayRows(): HTMLElement[] {
  const list = screen.queryByRole('listbox', { name: 'Tasks due today' });
  return list ? within(list).queryAllByRole('option') : [];
}

export function namesOf(rows: HTMLElement[]): string[] {
  return rows.map((row) => row.querySelector('p')?.textContent ?? '');
}

/** The sidebar's Today entry (the first 'Lists' navigation is the inline sidebar). */
export function todayNav(): HTMLElement {
  return within(screen.getAllByRole('navigation', { name: 'Lists', hidden: true })[0]!).getByRole('link', { name: /^Today/, hidden: true });
}
