import { QueryClient } from '@tanstack/react-query';
import type { LiveEvent } from '@todoodle/shared/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchDeps, dispatchEvent } from '@/features/live/dispatch';
import { clearLiveHandlersForTests, registerLiveHandler } from '@/features/live/registry';
import { registerProjectLiveHandlers } from '@/features/projects/registerProjectLiveHandlers';
import { queryKeys } from '@/lib/queryKeys';
import { makeTask } from '../../msw/tasks.ts';

// Story 7, TC-88: the project handlers are ADDED to story 4's registry and coexist with other stories'
// handlers for the same event type; unregistering them leaves the others intact.

const WS = '0123456789ABCDEF0123456789ABCDEF';

describe('TC-88 live registry coexistence', () => {
  afterEach(() => clearLiveHandlersForTests());

  it('a story-5-style task.upserted handler and the project handler both run once per event; after unregister only story 5', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const story5 = vi.fn(() => true);
    registerLiveHandler('task.upserted', story5);
    const unregister = registerProjectLiveHandlers({ currentProjectId: () => null, onViewedProjectDeleted: () => {} });
    const deps = dispatchDeps({ clientId: 'me', announcer: { record: () => {} }, notifyGuards: () => {} });
    const task = makeTask({ name: 'Draft Q3 plan', projectId: 'b'.repeat(32) });
    const event = { type: 'task.upserted', entity: task, version: 2, originClientId: 'someone-else' } as LiveEvent;

    expect(dispatchEvent({ queryClient, workspaceId: WS }, event, deps)).toBe('applied');
    expect(story5).toHaveBeenCalledTimes(1);
    // The project handler ran too: a task in a project refreshes the counts, once.
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.calls[0]![0]).toMatchObject({ queryKey: queryKeys.counts(WS) });

    unregister();
    dispatchEvent({ queryClient, workspaceId: WS }, { ...event, version: 3 }, deps);
    expect(story5).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
