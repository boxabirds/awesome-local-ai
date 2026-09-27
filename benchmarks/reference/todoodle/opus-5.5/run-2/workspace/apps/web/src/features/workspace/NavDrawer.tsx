import { type ReactNode, type RefObject, useCallback } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { SidebarContent } from './Sidebar';

export const NAV_DRAWER_ID = 'nav-drawer';

/**
 * The sidebar on phones: the same SidebarContent in a sheet from the left. Choosing a list closes
 * it; focus then returns to the menu button.
 */
export function NavDrawer({
  open,
  onOpenChange,
  workspaceId,
  menuButtonRef,
  searchSlot,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  workspaceId: string;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  searchSlot?: ReactNode;
}) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id={NAV_DRAWER_ID}
        data-app-shell=""
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const button = menuButtonRef.current;
          if (button?.isConnected) {
            event.preventDefault();
            button.focus();
          }
        }}
      >
        <SheetTitle className="px-3 text-sm font-semibold text-muted-foreground">Lists</SheetTitle>
        <nav aria-label="Lists">
          <SidebarContent workspaceId={workspaceId} onNavigate={close} searchSlot={searchSlot} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
