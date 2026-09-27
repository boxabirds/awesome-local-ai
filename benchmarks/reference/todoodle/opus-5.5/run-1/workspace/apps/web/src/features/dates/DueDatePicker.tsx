import { type LocalDate, chipLabel } from '@todoodle/shared/dates';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { CalendarIcon } from '@/components/icons';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { notifyAlert } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { DateChip } from './DateChip';
import { PICKER_LOAD_FAILED_TEXT, pickerPanel, preloadDatePicker } from './dueDatePickerLoader';
import { viewerLocale } from './locale';
import { useLocalDate } from './useLocalDate';

type PanelComponent = (typeof import('./picker/DueDatePickerPanel'))['DueDatePickerPanel'];

type Props = {
  value: LocalDate | null;
  /** Called once per choice (null: No date), then the picker closes. */
  onChange(value: LocalDate | null): void;
  disabled?: boolean;
  /** Controlled open state (the D key opens a row's picker); uncontrolled when absent. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /**
   * Opened for a task row (D): no trigger is rendered; the popover sits by this element (the row's chip slot) and
   * focus goes back to `returnFocusTo` (the row) when it closes.
   */
  anchor?: HTMLElement | null;
  returnFocusTo?: HTMLElement | null;
  /** Extra classes for the trigger button. */
  className?: string;
};

/** The trigger's accessible name: 'Set due date', or 'Due date: Tomorrow' / 'Due date: Overdue: due …'. */
export function triggerLabel(value: LocalDate | null, today: LocalDate): string {
  return value ? `Due date: ${chipLabel(value, today, viewerLocale()).srLabel.replace(/^Due /, '')}` : 'Set due date';
}

/**
 * The due date picker (ui.date_picker): a trigger (a calendar icon, or the date's chip) opening a popover with the
 * lazy panel. The trigger loads with the page; the panel chunk loads on first open and is preloaded on the trigger's
 * pointerenter and focus. If the chunk can't load, a toast says so and the next open retries. Focus returns to the
 * trigger (Radix) or, for a row's picker, to the row.
 */
export function DueDatePicker({ value, onChange, disabled = false, open: controlledOpen, onOpenChange, anchor, returnFocusTo, className }: Props) {
  const today = useLocalDate();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const wanted = controlledOpen ?? uncontrolledOpen;
  const [Panel, setPanel] = useState<PanelComponent | undefined>(() => pickerPanel.loaded()?.DueDatePickerPanel);
  const virtualRef = useMemo(() => ({ current: anchor ?? null }), [anchor]);

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // Load the panel chunk when the picker is wanted before it arrived (an external resource: effect-synced).
  useEffect(() => {
    if (!wanted || Panel) return;
    let active = true;
    pickerPanel.load().then(
      (module) => {
        if (active) setPanel(() => module.DueDatePickerPanel);
      },
      () => {
        if (!active) return;
        notifyAlert(PICKER_LOAD_FAILED_TEXT, 'date-picker-load-failed');
        if (controlledOpen === undefined) setUncontrolledOpen(false);
        onOpenChange?.(false);
      },
    );
    return () => {
      active = false;
    };
  }, [wanted, Panel, controlledOpen, onOpenChange]);

  const choose = (next: LocalDate | null) => {
    setOpen(false);
    onChange(next);
  };

  let trigger: ReactNode = null;
  if (anchor === undefined) {
    trigger = (
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={triggerLabel(value, today)}
          data-due-date-trigger
          onPointerEnter={preloadDatePicker}
          onFocus={preloadDatePicker}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 touch-target',
            className,
          )}
        >
          {value ? (
            <DateChip due={value} />
          ) : (
            <>
              <CalendarIcon aria-hidden="true" className="size-4" />
              <span aria-hidden="true">Due date</span>
            </>
          )}
        </button>
      </PopoverTrigger>
    );
  }

  return (
    <Popover open={wanted && Panel !== undefined} onOpenChange={setOpen}>
      {anchor === undefined ? trigger : <PopoverAnchor virtualRef={virtualRef} />}
      {Panel ? (
        <PopoverContent
          role="dialog"
          aria-label="Due date"
          align="start"
          collisionPadding={8}
          // Never taller than the room the popover has: it scrolls instead of leaving the screen.
          className="max-h-(--radix-popover-content-available-height) w-auto overflow-y-auto"
          data-due-date-picker
          onCloseAutoFocus={(event) => {
            if (anchor === undefined) return;
            event.preventDefault();
            if (returnFocusTo?.isConnected) returnFocusTo.focus();
          }}
        >
          <Panel value={value} today={today} onChoose={choose} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
