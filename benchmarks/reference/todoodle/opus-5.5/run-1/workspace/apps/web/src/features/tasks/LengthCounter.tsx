import { COUNTER_ANNOUNCE_THROTTLE_MS } from '@todoodle/shared/limits';
import { WarningIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { lengthStatus } from './canSubmit';
import { useThrottledValue } from './useThrottledValue';

function characters(n: number): string {
  return `${n} ${n === 1 ? 'character' : 'characters'}`;
}

/** The counter's text, or '' below the warning threshold. */
export function counterText(length: number, limit: number): string {
  const status = lengthStatus(length, limit);
  if (status === 'normal') return '';
  return status === 'over' ? `${characters(length - limit)} over` : `${characters(limit - length)} left`;
}

type Props = { id: string; length: number; limit: number };

/**
 * Remaining (or excess) characters for one field. Hidden below 90% of the limit. Past the limit it
 * turns destructive with a warning icon, so colour is never the only signal. The visible text follows
 * every keystroke; the polite live region announces at most once per COUNTER_ANNOUNCE_THROTTLE_MS.
 */
export function LengthCounter({ id, length, limit }: Props) {
  const text = counterText(length, limit);
  const announced = useThrottledValue(text, COUNTER_ANNOUNCE_THROTTLE_MS);
  const over = length > limit;
  return (
    <p id={id} data-counter className={cn('flex items-center gap-1 text-xs', over ? 'text-destructive' : 'text-muted-foreground', !text && 'sr-only')}>
      {over ? <WarningIcon aria-hidden="true" data-icon="warning" className="size-3.5" /> : null}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </p>
  );
}
