import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MenuIcon } from '@/components/icons';
import { useShortcutsPanel } from '@/features/shortcuts/useShortcutsPanel';
import { InboxView } from '@/features/tasks/InboxView';
import { registerTaskHandlers } from '@/features/tasks/liveHandlers';
import { NAV_DRAWER_ID, NavDrawer } from './NavDrawer';
import { Sidebar } from './Sidebar';
import { useIsNarrow } from './useIsNarrow';
import { WorkspaceHeader } from './WorkspaceHeader';

const bar = 'skeleton-shimmer rounded bg-muted';
const bodySkeleton = (
  <main aria-busy="true" aria-label="Loading tasks" className="flex flex-1 flex-col gap-4 p-6" data-testid="workspace-body-skeleton">
    <div className={`${bar} h-5 w-3/4`} />
    <div className={`${bar} h-5 w-2/3`} />
    <div className={`${bar} h-5 w-5/6`} />
  </main>
);

export type AppShellProps = {
  workspaceId: string;
  name: string;
  canEdit: boolean;
  /** Showing the remembered name only: the body is a skeleton. */
  loading?: boolean;
  /** Story 11: trailing header actions (its search button), at every width. */
  headerActionsSlot?: ReactNode;
  /** Story 11: rendered above the Inbox entry, inline and in the drawer. */
  searchSlot?: ReactNode;
};

/**
 * The workspace layout: header, navigation (an inline sidebar from MOBILE_BREAKPOINT_PX up, a
 * drawer behind ☰ below it), and the main region with the active view. The view sits inside the
 * edit gate (`<fieldset disabled>`); navigation stays usable outside it.
 */
export function AppShell({ workspaceId, name, canEdit, loading = false, headerActionsSlot = null, searchSlot = null }: AppShellProps) {
  const shortcutsPanel = useShortcutsPanel();
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Task live updates, once per workspace mount (one handler among others for the same type).
  useEffect(() => registerTaskHandlers(), [workspaceId]);

  // Widened past the breakpoint with the drawer open: the drawer is gone, so focus the view title.
  useEffect(() => {
    if (narrow || !drawerOpen) return;
    setDrawerOpen(false);
    document.getElementById('view-title')?.focus();
  }, [narrow, drawerOpen]);

  const menuButton = narrow ? (
    <button
      ref={menuButtonRef}
      type="button"
      aria-label="Open navigation"
      aria-expanded={drawerOpen}
      aria-controls={NAV_DRAWER_ID}
      onClick={() => setDrawerOpen(true)}
      className="inline-flex size-10 shrink-0 touch-target items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <MenuIcon aria-hidden="true" className="size-5" />
    </button>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col" data-app-shell="">
      {shortcutsPanel}
      <WorkspaceHeader workspaceId={workspaceId} name={name} canEdit={canEdit} leading={menuButton} actions={headerActionsSlot} />
      <div className="flex flex-1">
        {narrow ? (
          <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} workspaceId={workspaceId} menuButtonRef={menuButtonRef} searchSlot={searchSlot} />
        ) : (
          <Sidebar workspaceId={workspaceId} searchSlot={searchSlot} />
        )}
        <fieldset disabled={!canEdit} className="contents">
          <legend className="sr-only">Inbox</legend>
          {loading ? (
            bodySkeleton
          ) : (
            <main aria-labelledby="view-title" className="flex min-w-0 flex-1 flex-col gap-2 p-4 pb-24 md:p-6">
              <InboxView workspaceId={workspaceId} canEdit={canEdit} />
            </main>
          )}
        </fieldset>
      </div>
    </div>
  );
}
