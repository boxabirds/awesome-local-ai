import type { Counts } from '@todoodle/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { InboxIcon } from '@/components/icons';
import { countsQuery } from '@/features/tasks/queries';
import { SidebarNavItem } from './SidebarNavItem';

/** Hoisted so the reference is stable: the sidebar re-renders only when the number changes. */
const selectInboxCount = (counts: Counts) => counts.inbox;

export type SidebarContentProps = {
  workspaceId: string;
  /** Called after a list is chosen (the phone drawer closes). Must be stable. */
  onNavigate?: () => void;
  /** Story 11 (search) renders here, above the Inbox. */
  searchSlot?: ReactNode;
  /** Story 8 (Today) renders here. */
  todaySlot?: ReactNode;
  /** Story 7 (Projects) renders here. */
  projectsSlot?: ReactNode;
};

/**
 * The navigation content, shared by the inline sidebar and the phone drawer (one component, no
 * duplicate markup). The Inbox has no rename or delete controls: it is not a stored list.
 */
export function SidebarContent({ workspaceId, onNavigate, searchSlot = null, todaySlot = null, projectsSlot = null }: SidebarContentProps) {
  const { pathname, hash } = useLocation();
  const counts = useQuery({ ...countsQuery(workspaceId), select: selectInboxCount });
  return (
    <div className="flex flex-col gap-1">
      {searchSlot}
      <SidebarNavItem
        to={`${pathname}${hash}`}
        label="Inbox"
        icon={InboxIcon}
        count={counts.data}
        countFailed={counts.isError}
        active
        onSelect={onNavigate}
      />
      {todaySlot}
      {projectsSlot}
    </div>
  );
}

/** The inline sidebar (at or above MOBILE_BREAKPOINT_PX). */
export function Sidebar(props: SidebarContentProps) {
  return (
    <nav aria-label="Lists" className="flex w-60 shrink-0 flex-col border-r border-border p-3">
      <SidebarContent {...props} />
    </nav>
  );
}
