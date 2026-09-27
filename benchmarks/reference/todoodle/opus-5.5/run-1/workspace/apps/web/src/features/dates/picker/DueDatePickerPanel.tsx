import { type LocalDate, SHORTCUT_KEYS, type ShortcutId, formatFullDate, formatShortcutDate, shortcutDates } from '@todoodle/shared/dates';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { type KeyboardEvent, useMemo } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { viewerLocale } from '../locale';

// The lazy chunk behind DueDatePicker: the five shortcuts (each showing the date it means) and a month grid. The
// only place date-fns is imported (subpath imports), together with react-day-picker.

type Props = {
  value: LocalDate | null;
  /** The viewer's local date (the clock store), which the shortcuts resolve from. */
  today: LocalDate;
  /** Called once with the chosen date (null: No date); the picker then closes. */
  onChoose(value: LocalDate | null): void;
};

const SHORTCUT_NAMES: Record<Exclude<ShortcutId, 'none'>, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  weekend: 'This weekend',
  nextWeek: 'Next week',
};
const SHORTCUT_ORDER = ['today', 'tomorrow', 'weekend', 'nextWeek'] as const;
const KEY_HINT: Record<ShortcutId, string> = { today: 'T', tomorrow: 'M', weekend: 'W', nextWeek: 'N', none: '0' };

const ITEM =
  'flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring touch-target';

/** 'YYYY-MM-DD' <-> the local Date react-day-picker works with (midnight local time). */
const toDate = (value: LocalDate) => parseISO(value);
const toLocalDate = (date: Date): LocalDate => format(date, 'yyyy-MM-dd');

/**
 * Shortcuts: 'Today · Fri 25 Sep', 'Tomorrow · Sat 26 Sep', 'This weekend · Sat 26 Sep', 'Next week · Mon 28 Sep',
 * 'No date', then the calendar. Keys (prd.picker_keyboard), handled here and not by the global listener: T, M, W,
 * N and 0 choose a shortcut; the grid moves with arrows, PageUp/PageDown and Home/End; Enter picks; Escape closes
 * (the popover's). Keys never leave the panel (quick add's Escape and the app's shortcuts never see them).
 */
export function DueDatePickerPanel({ value, today, onChoose }: Props) {
  const locale = viewerLocale();
  // Derived during render (rerender-derived-state-no-effect).
  const dates = shortcutDates(today);
  const selected = value ? toDate(value) : undefined;
  const todayDate = useMemo(() => toDate(today), [today]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // The popover closes itself (Radix listens on the document); nothing else may act on this Escape.
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    const shortcut = SHORTCUT_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!shortcut) return;
    event.preventDefault();
    event.stopPropagation();
    onChoose(shortcut === 'none' ? null : dates[shortcut]);
  };

  return (
    <div data-due-date-panel onKeyDown={onKeyDown} className="flex flex-col gap-2">
      <div role="group" aria-label="Shortcuts" className="flex flex-col">
        {SHORTCUT_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            data-shortcut={id}
            aria-label={`${SHORTCUT_NAMES[id]}, ${formatFullDate(dates[id], locale)}`}
            aria-keyshortcuts={KEY_HINT[id]}
            onClick={() => onChoose(dates[id])}
            className={ITEM}
          >
            <span>{`${SHORTCUT_NAMES[id]} · ${formatShortcutDate(dates[id], locale)}`}</span>
            <kbd aria-hidden="true" className="font-sans text-xs text-muted-foreground">
              {KEY_HINT[id]}
            </kbd>
          </button>
        ))}
        <button type="button" data-shortcut="none" aria-label="No date" aria-keyshortcuts="0" onClick={() => onChoose(null)} className={cn(ITEM)}>
          <span>No date</span>
          <kbd aria-hidden="true" className="font-sans text-xs text-muted-foreground">
            0
          </kbd>
        </button>
      </div>
      <Calendar
        mode="single"
        selected={selected}
        defaultMonth={selected ?? todayDate}
        today={todayDate}
        weekStartsOn={1}
        onSelect={(_day, triggerDate) => onChoose(toLocalDate(triggerDate))}
      />
    </div>
  );
}
