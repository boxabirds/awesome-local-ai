import { Dialog as DialogPrimitive, Popover } from 'radix-ui';
import { type ReactNode, useMemo } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useIsNarrow } from '@/features/workspace/useIsNarrow';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The element it belongs to (e.g. a task row): anchored beside it on wide screens. */
  anchor?: HTMLElement | null;
  /** Escape: call event.preventDefault() to keep it open (e.g. to clear a query first). */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Where focus goes when it closes (the default returns it to what had focus before). */
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
};

const SURFACE = 'z-50 flex flex-col gap-2 border border-border bg-background p-2 text-foreground shadow-lg outline-none';

/**
 * The container of a searchable list (Move to…; story 11's Finder): a popover anchored to `anchor` (or a
 * centred dialog without one) at or above MOBILE_BREAKPOINT_PX, and a panel from the bottom of the screen
 * below it. The content (input + listbox) is the caller's and filters with its own rules.
 */
export function ResponsiveCommand({ open, onOpenChange, title, anchor = null, onEscapeKeyDown, onCloseAutoFocus, children }: Props) {
  const narrow = useIsNarrow();
  const virtualRef = useMemo(() => ({ current: anchor }), [anchor]);

  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" aria-describedby={undefined} data-drawer onEscapeKeyDown={onEscapeKeyDown} onCloseAutoFocus={onCloseAutoFocus}>
          <SheetTitle className="px-1 text-sm font-semibold">{title}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  if (anchor) {
    return (
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Anchor virtualRef={virtualRef} />
        <Popover.Portal>
          <Popover.Content
            role="dialog"
            aria-label={title}
            align="end"
            sideOffset={4}
            collisionPadding={8}
            data-popover
            onEscapeKeyDown={onEscapeKeyDown}
            onCloseAutoFocus={onCloseAutoFocus}
            className={cn(SURFACE, 'w-80 max-w-[calc(100vw-2rem)] rounded-md')}
          >
            <p aria-hidden="true" className="px-1 text-sm font-semibold">
              {title}
            </p>
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(SURFACE, 'fixed left-1/2 top-24 w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl')}
        >
          <DialogPrimitive.Title className="px-1 text-sm font-semibold">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
