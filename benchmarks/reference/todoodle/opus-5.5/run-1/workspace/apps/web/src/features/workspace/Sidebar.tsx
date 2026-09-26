import { useQuery } from '@tanstack/react-query';
import type { Counts } from '@todoodle/shared/schemas';
import type { ReactNode } from 'react';
import { countsQuery } from '@/features/tasks/queries';
import { SidebarNavItem } from './SidebarNavItem';

/** The views the sidebar can open. Stories 7 and 8 add theirs. */
export type WorkspaceViewName = 'inbox';

export type SidebarSlotProps = { current: string; onNavigate: (view: string) => void };

export type SidebarProps = {
  workspaceId: string;
  current: WorkspaceViewName;
  onNavigate: (view: string) => void;
  /** Story 8 fills it with Today. Renders nothing in story 5. */
  todaySlot?: (props: SidebarSlotProps) => ReactNode;
  /** Story 7 fills it with Projects. Renders nothing in story 5. */
  projectsSlot?: (props: SidebarSlotProps) => ReactNode;
  /** Story 11 (search) renders above the Inbox entry, inline and in the drawer. */
  searchSlot?: ReactNode;
};

// Hoisted, so the reference is stable and the sidebar re-renders only when the number changes.
const selectInboxCount = (counts: Counts) => counts.inbox;

/**
 * The sidebar's content: the same component inline (desktop) and inside the phone drawer, so there is
 * no duplicate nav markup. The Inbox has no rename or delete controls: it is not a row, it is the
 * tasks with no project.
 */
export function SidebarContent({ workspaceId, current, onNavigate, todaySlot, projectsSlot, searchSlot = null }: SidebarProps) {
  const inbox = useQuery({ ...countsQuery(workspaceId), select: selectInboxCount });
  const slotProps = { current, onNavigate };
  return (
    <div className="flex flex-col gap-1">
      {searchSlot}
      <SidebarNavItem
        label="Inbox"
        icon="inbox"
        view="inbox"
        count={inbox.data}
        countLoading={inbox.isPending}
        current={current === 'inbox'}
        onSelect={onNavigate}
      />
      {todaySlot?.(slotProps) ?? null}
      {projectsSlot?.(slotProps) ?? null}
    </div>
  );
}

/** The inline sidebar (at or above MOBILE_BREAKPOINT_PX). */
export function Sidebar(props: SidebarProps) {
  return (
    <aside className="w-60 shrink-0 border-r border-border p-3">
      <nav aria-label="Lists">
        <SidebarContent {...props} />
      </nav>
    </aside>
  );
}
