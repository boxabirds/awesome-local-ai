import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
export const SheetClose = DialogPrimitive.Close;

const SIDES = {
  left: 'inset-y-0 left-0 w-72 max-w-[85vw] border-r animate-[sheet-in_200ms_ease-out]',
  // Full screen below MOBILE_BREAKPOINT_PX (Tailwind md), a right-hand panel from there up.
  right: 'inset-0 w-full md:left-auto md:w-[28rem] md:max-w-[90vw] md:border-l animate-[sheet-in-right_200ms_ease-out]',
};

/** A panel sliding in from the left (navigation) or right (task detail) edge: a Radix Dialog (focus trap, Escape closes). */
export function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { side?: keyof typeof SIDES }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col gap-4 border-border bg-background p-4 text-foreground shadow-lg',
          SIDES[side],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
