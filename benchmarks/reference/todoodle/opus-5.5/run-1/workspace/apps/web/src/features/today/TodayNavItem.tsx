import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Counts } from '@todoodle/shared/schemas';
import { type MouseEvent, memo, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { CalendarDaysIcon } from '@/components/icons';
import { countsQuery } from '@/features/tasks/queries';
import { navItemName } from '@/features/workspace/SidebarNavItem';
import { workspacePath } from '@/features/workspace/useWorkspaceNavigate';
import { preloadTodayView } from '@/routes/lazy';
import { cn } from '@/lib/utils';
import { prefetchToday } from './todayLoader';

// Hoisted: stable select (the item re-renders only when the number changes).
const selectTodayCount = (counts: Counts) => counts.today;

type Props = {
  workspaceId: string;
  current: boolean;
  /** Shared sidebar navigation (the drawer also closes itself). */
  onNavigate: (view: string) => void;
};

/** Runs `fn` when the browser is idle (a timeout where requestIdleCallback is missing). Returns a cancel function. */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(fn);
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(fn, 0);
  return () => clearTimeout(timer);
}

function preloadChunk() {
  preloadTodayView().catch(() => undefined);
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The sidebar's Today entry (prd.today_count, prd.today_address): a link to /w/:id/today (reload, back and forward
 * return to Today; it can open in a new tab), with the number of open tasks due today or overdue. The number comes
 * from the shared counts query (no request of its own) and is hidden at 0, when unknown or when counts failed.
 * Hover or focus preloads the view's chunk and prefetches Today and the counts in parallel; the chunk also loads when
 * the browser is first idle.
 */
export const TodayNavItem = memo(function TodayNavItem({ workspaceId, current, onNavigate }: Props) {
  const queryClient = useQueryClient();
  const { hash } = useLocation();
  const { data: count } = useQuery({ ...countsQuery(workspaceId), select: selectTodayCount });
  const preload = () => {
    preloadChunk();
    void prefetchToday(queryClient, workspaceId);
  };
  // The view's chunk also loads once the browser is idle: opening Today never waits on it (React holds a suspended
  // route's first reveal back by up to ~300 ms), even without a hover first (keyboard, touch, a reload elsewhere).
  useEffect(() => whenIdle(preloadChunk), []);
  return (
    <Link
      to={{ pathname: workspacePath(workspaceId, { view: 'today' }), hash }}
      aria-current={current ? 'page' : undefined}
      aria-label={navItemName('Today', count)}
      data-nav-item="today"
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onNavigate('today');
      }}
      onPointerEnter={preload}
      onFocus={preload}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch-target',
        current && 'bg-muted font-medium',
      )}
    >
      <CalendarDaysIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate">Today</span>
      <span aria-hidden="true" data-count-slot data-today-badge className="flex w-8 shrink-0 justify-end text-xs tabular-nums text-muted-foreground">
        {count ? count : null}
      </span>
    </Link>
  );
});
