import { useEffect, useRef, useState } from 'react';

/**
 * `value`, but changing at most once per `intervalMs` (leading edge, then the latest value when the
 * interval ends). Used for screen-reader announcements, so a counter is not read out on every keystroke.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastChange = useRef(0);
  useEffect(() => {
    const wait = lastChange.current + intervalMs - Date.now();
    if (wait <= 0) {
      lastChange.current = Date.now();
      setThrottled(value);
      return;
    }
    const timer = setTimeout(() => {
      lastChange.current = Date.now();
      setThrottled(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);
  return throttled;
}
