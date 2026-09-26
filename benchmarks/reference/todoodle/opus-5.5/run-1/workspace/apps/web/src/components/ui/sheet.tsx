import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// shadcn-style Sheet: a Radix Dialog (focus trap, Escape closes) sliding in from one side.
export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { side?: 'left' | 'right' | 'bottom' }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 border-border bg-background p-4 text-foreground shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=open]:duration-200',
          side === 'bottom'
            ? // Story 7: a panel from the bottom of the screen (phones), e.g. Move to….
              'inset-x-0 bottom-0 max-h-[85svh] rounded-t-xl border-t pb-[max(1rem,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom'
            : cn(
                'inset-y-0 w-72 max-w-[85vw]',
                side === 'left' ? 'left-0 border-r data-[state=open]:slide-in-from-left' : 'right-0 border-l data-[state=open]:slide-in-from-right',
              ),
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
