import { chipLabel } from '@todoodle/shared/dates';
import { memo } from 'react';
import { WarningIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { viewerLocale } from './locale';
import { useLocalDate } from './useLocalDate';

/** Tone -> text colour (CSS tokens --chip-*, AA in light and dark). */
export const CHIP_TONE_CLASS = {
  overdue: 'text-chip-overdue',
  today: 'text-chip-today',
  tomorrow: 'text-chip-tomorrow',
  neutral: 'text-chip-neutral',
} as const;

// Hoisted static JSX (rendering-hoist-jsx): the icon is decoration; the words and the label carry the meaning.
const warningIcon = <WarningIcon aria-hidden="true" data-chip-warning className="size-3.5 shrink-0" />;

/**
 * A due date relative to the viewer's local date (prd.date_chip): 'Today' (green), 'Tomorrow' (orange), a weekday,
 * a short date; overdue says 'Yesterday' / 'N days overdue' in red with a warning icon (prd.overdue_accessible).
 * Its accessible name is the screen-reader label ('Overdue: due Tuesday 22 September'). Primitive props (memo);
 * re-renders at local midnight through useLocalDate.
 */
export const DateChip = memo(function DateChip({ due, className }: { due: string; className?: string }) {
  const today = useLocalDate();
  const label = chipLabel(due, today, viewerLocale());
  return (
    <span
      role="img"
      aria-label={label.srLabel}
      data-date-chip={label.tone}
      className={cn('inline-flex items-center gap-1 text-xs font-medium', CHIP_TONE_CLASS[label.tone], className)}
    >
      {label.showWarningIcon ? warningIcon : null}
      <span aria-hidden="true">{label.text}</span>
    </span>
  );
});
