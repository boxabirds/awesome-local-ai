import ChevronLeftIcon from 'lucide-react/icons/chevron-left';
import ChevronRightIcon from 'lucide-react/icons/chevron-right';
import { type ComponentProps, useEffect, useRef } from 'react';
import { type DayButton, DayPicker, getDefaultClassNames } from 'react-day-picker';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// shadcn/ui calendar (new-york, react-day-picker 9), trimmed to single-date selection and this app's tokens.
// Only the lazy date picker chunk imports it.

export function Calendar({ className, classNames, showOutsideDays = true, components, ...props }: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('group/calendar p-1 [--cell-size:2.25rem]', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('relative flex flex-col gap-4', defaults.months),
        month: cn('flex w-full flex-col gap-3', defaults.month),
        nav: cn('absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1', defaults.nav),
        button_previous: cn(buttonVariants({ variant: 'ghost' }), 'size-(--cell-size) p-0 select-none aria-disabled:opacity-50', defaults.button_previous),
        button_next: cn(buttonVariants({ variant: 'ghost' }), 'size-(--cell-size) p-0 select-none aria-disabled:opacity-50', defaults.button_next),
        month_caption: cn('flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)', defaults.month_caption),
        caption_label: cn('text-sm font-medium select-none', defaults.caption_label),
        month_grid: cn('w-full border-collapse', defaults.month_grid),
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn('flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none', defaults.weekday),
        week: cn('mt-1 flex w-full', defaults.week),
        day: cn('group/day relative aspect-square h-full w-full p-0 text-center select-none', defaults.day),
        today: cn('rounded-md font-semibold text-primary', defaults.today),
        outside: cn('text-muted-foreground', defaults.outside),
        disabled: cn('text-muted-foreground opacity-50', defaults.disabled),
        hidden: cn('invisible', defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClass, orientation }) =>
          orientation === 'left' ? (
            <ChevronLeftIcon aria-hidden="true" className={cn('size-4', chevronClass)} />
          ) : (
            <ChevronRightIcon aria-hidden="true" className={cn('size-4', chevronClass)} />
          ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

/** One day: a button; keyboard focus follows react-day-picker's focused day (arrows, PageUp/Down, Home/End). */
export function CalendarDayButton({ className, day, modifiers, ...props }: ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return (
    <button
      ref={ref}
      type="button"
      data-day={day.isoDate}
      data-selected-single={modifiers.selected || undefined}
      className={cn(
        'flex aspect-square w-full min-w-(--cell-size) items-center justify-center rounded-md text-sm leading-none outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground',
        className,
      )}
      {...props}
    />
  );
}
