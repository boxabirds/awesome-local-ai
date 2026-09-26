import { memo } from 'react';
import { InboxIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

const ICONS = { inbox: InboxIcon } as const;
export type NavIcon = keyof typeof ICONS;

type Props = {
  label: string;
  icon: NavIcon;
  /** Open tasks in the list; undefined when unknown (failed to load). */
  count: number | undefined;
  countLoading: boolean;
  current: boolean;
  /** The view this item opens (passed back to onSelect, so the callback can be shared and stable). */
  view: string;
  onSelect: (view: string) => void;
};

/** The accessible name: 'Inbox, 3 open tasks' when there are open tasks, otherwise just the label. */
export function navItemName(label: string, count: number | undefined): string {
  if (!count) return label;
  return `${label}, ${count} open ${count === 1 ? 'task' : 'tasks'}`;
}

/**
 * One sidebar entry. Memoised with primitive props, so it re-renders only when its own count or state
 * changes. The count slot keeps a fixed width (skeleton while loading, empty when zero), so nothing shifts.
 */
export const SidebarNavItem = memo(function SidebarNavItem({ label, icon, count, countLoading, current, view, onSelect }: Props) {
  const Icon = ICONS[icon];
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      aria-label={navItemName(label, count)}
      data-nav-item={view}
      onClick={() => onSelect(view)}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch-target',
        current && 'bg-muted font-medium',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span aria-hidden="true" data-count-slot className="flex w-8 shrink-0 justify-end text-xs tabular-nums text-muted-foreground">
        {countLoading ? <span data-count-skeleton className="h-3 w-5 rounded bg-muted motion-safe:animate-pulse" /> : count ? count : null}
      </span>
    </button>
  );
});
