import type { RefObject } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { SidebarContent, type SidebarProps } from './Sidebar';

export const NAV_DRAWER_ID = 'nav-drawer';

type Props = SidebarProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ☰ button: focus returns there when the drawer closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * The phone layout's sidebar: the same SidebarContent inside a left sheet (Radix Dialog: focus trap,
 * Escape closes). Choosing a list navigates and closes it; focus goes back to ☰.
 */
export function NavDrawer({ open, onOpenChange, triggerRef, onNavigate, ...sidebar }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id={NAV_DRAWER_ID}
        side="left"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <SheetTitle className="px-3 text-sm font-semibold text-muted-foreground">Lists</SheetTitle>
        <nav aria-label="Lists">
          <SidebarContent
            {...sidebar}
            onNavigate={(view) => {
              onNavigate(view);
              onOpenChange(false);
            }}
          />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
