import { COUNTER_ANNOUNCE_THROTTLE_MS } from '@todoodle/shared/limits';
import { useEffect, useRef, useState } from 'react';
import { WarningIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { lengthStatus } from './canSubmit';

const plural = (n: number) => (n === 1 ? 'character' : 'characters');

/** The counter's text for a length, or '' below the warning threshold. */
export function counterText(length: number, limit: number): string {
  switch (lengthStatus(length, limit)) {
    case 'normal':
      return '';
    case 'near':
      return `${limit - length} ${plural(limit - length)} left`;
    case 'over':
      return `${length - limit} ${plural(length - limit)} over`;
  }
}

/** `value`, updated at most once per `ms` (first value at once, the latest one after the wait). */
function useThrottledValue(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  const lastAt = useRef(0);
  useEffect(() => {
    if (value === shown) return;
    const wait = lastAt.current + ms - Date.now();
    const update = () => {
      lastAt.current = Date.now();
      setShown(value);
    };
    if (wait <= 0) {
      update();
      return;
    }
    const timer = setTimeout(update, wait);
    return () => clearTimeout(timer);
  }, [value, shown, ms]);
  return shown;
}

/**
 * Remaining characters from 90% of the limit ("32 characters left"), and past the limit "12
 * characters over" in the destructive colour with a warning icon (colour is never the only
 * signal). The visible counter (the field's aria-describedby target) is always current; the
 * polite live region repeats it at most once per COUNTER_ANNOUNCE_THROTTLE_MS.
 */
export function LengthCounter({ id, length, limit }: { id: string; length: number; limit: number }) {
  const text = counterText(length, limit);
  const announced = useThrottledValue(text, COUNTER_ANNOUNCE_THROTTLE_MS);
  const over = lengthStatus(length, limit) === 'over';
  return (
    <>
      {text ? (
        <p id={id} className={cn('flex items-center gap-1 text-xs', over ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {over ? <WarningIcon aria-hidden="true" data-icon="warning" className="size-3.5 shrink-0" /> : null}
          {text}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announced}
      </p>
    </>
  );
}
