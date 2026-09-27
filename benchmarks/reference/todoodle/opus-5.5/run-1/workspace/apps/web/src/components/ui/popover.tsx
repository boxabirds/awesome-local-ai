import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui popover (new-york), adapted to this app's tokens and imports (added for story 8's date picker).

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/** The floating surface. Radix renders it only while open. */
export function PopoverContent({ className, align = 'center', sideOffset = 4, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-3 text-foreground shadow-md outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
