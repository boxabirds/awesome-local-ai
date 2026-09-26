import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { MenuIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ShortcutsPanelLazy } from '@/features/shortcuts/ShortcutsPanelLazy';
import { useShortcutsPanel } from '@/features/shortcuts/useShortcutsPanel';
import { registerTaskLiveHandlers } from '@/features/tasks/liveHandlers';
import { NAV_DRAWER_ID, NavDrawer } from './NavDrawer';
import { Sidebar, type SidebarProps, type WorkspaceViewName } from './Sidebar';
import { useIsNarrow } from './useIsNarrow';

export type HeaderSlots = {
  /** The phone layout's ☰ button (null at or above the breakpoint). */
  navButton: ReactNode;
  /** Trailing header actions (story 11's search button), at every width. */
  actions: ReactNode;
};

type Props = {
  workspaceId: string;
  canEdit: boolean;
  /** Rendered above the header (story 4's offline banner). */
  banner?: ReactNode;
  renderHeader: (slots: HeaderSlots) => ReactNode;
  headerActionsSlot?: ReactNode;
  searchSlot?: SidebarProps['searchSlot'];
  /** The active view (the Inbox by default). It must render the #view-title heading. */
  children: ReactNode;
};

/**
 * The workspace layout: header, sidebar and the active view in <main>. At or above MOBILE_BREAKPOINT_PX
 * the sidebar is inline; below it, the same sidebar content lives in a drawer opened from ☰. The sidebar
 * and main areas sit inside story 4's edit gate (one fieldset, disabled while !canEdit).
 */
export function AppShell({ workspaceId, canEdit, banner = null, renderHeader, headerActionsSlot = null, searchSlot, children }: Props) {
  const [view, setView] = useState<WorkspaceViewName>('inbox');
  const onNavigate = useCallback((next: string) => setView(next as WorkspaceViewName), []);
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Live task changes from others land in the task caches (one handler among several, never replacing any).
  useEffect(() => registerTaskLiveHandlers(), []);
  // ? anywhere (not while typing) lists every keyboard shortcut.
  const shortcutsPanel = useShortcutsPanel();

  // Widened past the breakpoint with the drawer open: the drawer goes away and focus moves to the view.
  if (!narrow && drawerOpen) {
    setDrawerOpen(false);
    queueMicrotask(() => document.getElementById('view-title')?.focus());
  }

  const sidebarProps = { workspaceId, current: view, onNavigate, searchSlot };
  const navButton = narrow ? (
    <Button
      ref={menuButtonRef}
      variant="ghost"
      className="w-11 px-0"
      aria-label="Open navigation"
      aria-expanded={drawerOpen}
      aria-controls={NAV_DRAWER_ID}
      onClick={() => setDrawerOpen(true)}
    >
      <MenuIcon aria-hidden="true" />
    </Button>
  ) : null;

  return (
    <div className="flex min-h-svh flex-col">
      {banner}
      {renderHeader({ navButton, actions: headerActionsSlot })}
      <fieldset disabled={!canEdit} className="contents">
        <div className="flex flex-1">
          {narrow ? null : <Sidebar {...sidebarProps} />}
          <main aria-labelledby="view-title" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </fieldset>
      {narrow ? <NavDrawer {...sidebarProps} open={drawerOpen} onOpenChange={setDrawerOpen} triggerRef={menuButtonRef} /> : null}
      <ShortcutsPanelLazy open={shortcutsPanel.open} onOpenChange={shortcutsPanel.onOpenChange} />
    </div>
  );
}
