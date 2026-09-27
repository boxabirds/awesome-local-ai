import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { LiveEvent } from '@todoodle/shared/events';
import { MIDNIGHT_SLACK_MS, TODAY_INVALIDATE_DEBOUNCE_MS } from '@todoodle/shared/limits';
import type { Counts, Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchDeps, dispatchEvent } from '@/features/live/dispatch';
import { registerTaskLiveHandlers } from '@/features/tasks/liveHandlers';
import { registerTodayHandlers } from '@/features/today/registerTodayHandlers';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { todayServer } from '../../msw/todayServer.ts';
import { startLiveServer } from '../../support/live.ts';
import { OTHER_CLIENT } from '../../support/liveFixtures.ts';
import { ID, TODAY, dated, enterToday, namesOf, overdueRows, todayNav, todayRows } from '../../support/today.tsx';

// Story 8: live refresh of Today (through the REAL story 4 registry), midnight rollover, and the counts key.

afterEach(() => vi.useRealTimers());

/** Fake Date and timers from `now`, advancing with real time (MSW, waitFor); labels in en-GB. */
function clockAt(now: Date) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true, now });
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
}

function upserted(task: Task, originClientId: string | null = OTHER_CLIENT): LiveEvent {
  return LiveEvent.parse({ type: 'task.upserted', entity: task, version: task.version, originClientId });
}

describe('ui.today_view: live refresh', () => {
  it("TC-80 another person moves a task to next week: it leaves Today after the debounce; the badge follows the counts refetch", async () => {
    clockAt(new Date(2026, 8, 25, 9, 0, 0));
    const live = startLiveServer(ID);
    const milk = dated('Buy milk', TODAY, 0);
    const api = todayServer({ tasks: [milk, dated('Pay council tax', TODAY, 1)] });
    await enterToday(api);
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk', 'Pay council tax']));
    await waitFor(() => expect(todayNav()).toHaveAccessibleName('Today, 2 open tasks'));
    await waitFor(() => expect(live.clients().length).toBeGreaterThan(0));
    const todayCalls = api.callsOf('today').length;
    const countsCalls = api.callsOf('counts').length;

    const moved = api.change(milk.id, { dueDate: '2026-10-02' });
    await act(async () => live.emit(upserted(moved)));
    // Debounced: nothing yet.
    expect(api.callsOf('today')).toHaveLength(todayCalls);
    await act(async () => vi.advanceTimersByTime(TODAY_INVALIDATE_DEBOUNCE_MS + 10));
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Pay council tax']));
    await waitFor(() => expect(todayNav()).toHaveAccessibleName('Today, 1 open task'));
    expect(api.callsOf('today')).toHaveLength(todayCalls + 1);
    expect(api.callsOf('counts')).toHaveLength(countsCalls + 1);
  });

  it('TC-124 the registry keeps every story\'s handlers: story 5\'s and Today\'s both run; an own echo invalidates nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const client = new QueryClient();
    const ctx = { queryClient: client, workspaceId: ID };
    const task = dated('Buy milk', TODAY, 0);
    client.setQueryData(queryKeys.tasks(ID, { list: 'inbox' }), [task]);
    client.setQueryData(queryKeys.today(ID, { date: TODAY, includeCompleted: false }), { date: TODAY, overdue: [], today: [{ ...task, projectName: null, projectColor: null }], completed: [] });
    client.setQueryData(queryKeys.counts(ID), { inbox: 1, projects: {}, today: 1 });
    const unregisterTasks = registerTaskLiveHandlers();
    const unregisterToday = registerTodayHandlers();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const self = '11111111-2222-4333-8444-555555555555';
    const deps = dispatchDeps({ clientId: self, announcer: { record: () => {} }, notifyGuards: () => {} });

    // Own echo: dropped before any handler.
    expect(dispatchEvent(ctx, upserted({ ...task, name: 'Mine', version: 2 }, self), deps)).toBe('echo');
    vi.advanceTimersByTime(TODAY_INVALIDATE_DEBOUNCE_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();

    // From someone else: story 5's handler patches the Inbox cache AND Today's handler refetches Today.
    expect(dispatchEvent(ctx, upserted({ ...task, name: 'Buy oat milk', version: 2 }), deps)).toBe('applied');
    expect(client.getQueryData<Task[]>(queryKeys.tasks(ID, { list: 'inbox' }))!.map((t) => t.name)).toEqual(['Buy oat milk']);
    vi.advanceTimersByTime(TODAY_INVALIDATE_DEBOUNCE_MS + 1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.today(ID) });
    unregisterTasks();
    unregisterToday();
  });
});

describe('ui.midnight_rollover', () => {
  it('TC-85 across midnight: tomorrow\'s task joins Today, today\'s becomes overdue; a new Today request for the new date; counts refetched once (same key)', async () => {
    clockAt(new Date(2026, 8, 25, 23, 59, 59));
    const api = todayServer({ tasks: [dated('Buy milk', '2026-09-25', 0), dated('Renew passport', '2026-09-26', 1)] });
    await enterToday(api);
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk']));
    expect(screen.getByRole('heading', { name: 'Today · Fri 25 Sep', level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(api.callsOf('counts').length).toBeGreaterThan(0));
    const countsBefore = api.callsOf('counts').length;

    await act(async () => vi.advanceTimersByTime(1_000 + MIDNIGHT_SLACK_MS + 50));
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Renew passport']));
    expect(namesOf(overdueRows())).toEqual(['Buy milk']);
    expect(screen.getByRole('heading', { name: 'Today · Sat 26 Sep', level: 2 })).toBeInTheDocument();
    expect(api.callsOf('today').map((c) => c.url)).toContain('?date=2026-09-26');
    await waitFor(() => expect(api.callsOf('counts')).toHaveLength(countsBefore + 1));
    expect(api.callsOf('counts').at(-1)!.url).toBe('?date=2026-09-26');
    expect(queryClient.getQueryCache().findAll({ queryKey: queryKeys.counts(ID) }).map((q) => q.queryKey)).toEqual([['ws', ID, 'counts']]);
  });

  it("TC-120 the counts key has no date; the queryFn sends the clock's date; rollover makes exactly one new request; story 5's setQueryData lands in the same entry", async () => {
    clockAt(new Date(2026, 8, 25, 23, 59, 59));
    const api = todayServer({ tasks: [dated('Buy milk', '2026-09-25', 0)] });
    await enterToday(api, `/w/${ID}`, 'Inbox');
    await waitFor(() => expect(api.callsOf('counts')).toHaveLength(1));
    expect(api.callsOf('counts')[0]!.url).toBe('?date=2026-09-25');
    const entries = () => queryClient.getQueryCache().findAll({ queryKey: queryKeys.counts(ID) });
    expect(entries().map((q) => q.queryKey)).toEqual([['ws', ID, 'counts']]);

    await act(async () => vi.advanceTimersByTime(2_000 + MIDNIGHT_SLACK_MS));
    await waitFor(() => expect(api.callsOf('counts')).toHaveLength(2));
    expect(api.callsOf('counts')[1]!.url).toBe('?date=2026-09-26');
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(api.callsOf('counts')).toHaveLength(2);

    act(() => {
      queryClient.setQueryData<Counts>(queryKeys.counts(ID), (counts) => ({ ...counts!, inbox: 42 }));
    });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]!.state.data).toMatchObject({ inbox: 42, today: 1 });
  });
});
