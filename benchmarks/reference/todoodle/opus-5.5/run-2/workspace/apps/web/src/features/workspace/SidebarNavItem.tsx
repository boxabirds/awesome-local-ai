import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export type SidebarNavItemProps = {
  /** Where the item leads (a path, with the hash on the /w#secret route). */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Open tasks; hidden when 0. `undefined` while loading shows a fixed-width skeleton. */
  count: number | undefined;
  /** True once the count has failed: the badge stays empty (never blocks navigation). */
  countFailed?: boolean;
  active: boolean;
  /** Called after the item is chosen (the phone drawer closes). Must be stable. */
  onSelect?: () => void;
};

function accessibleName(label: string, count: number | undefined): string {
  if (!count) return label;
  return `${label}, ${count} open ${count === 1 ? 'task' : 'tasks'}`;
}

/** One list in the sidebar. Memoised with primitive props: it re-renders only when its count changes. */
export const SidebarNavItem = memo(function SidebarNavItem({ to, label, icon: Icon, count, countFailed = false, active, onSelect }: SidebarNavItemProps) {
  const loading = count === undefined && !countFailed;
  return (
    <Link
      to={to}
      onClick={onSelect}
      aria-label={accessibleName(label, count)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 touch-target items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        active ? 'bg-muted' : 'hover:bg-muted',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {/* The badge's width is reserved in every state, so the row never shifts when the count arrives. */}
      <span aria-hidden="true" data-testid={`${label.toLowerCase()}-count`} className="flex w-8 justify-end text-xs text-muted-foreground tabular-nums">
        {loading ? <span data-testid="count-skeleton" className="skeleton-shimmer h-4 w-5 rounded bg-muted" /> : count ? count : null}
      </span>
    </Link>
  );
});
