import type { LocalDate } from '@todoodle/shared/dates';
import { useSyncExternalStore } from 'react';
import { getLocalDateSnapshot, subscribe } from './clockStore';

/** The viewer's current local date; re-renders exactly when it changes (local midnight, or back from a hidden tab). */
export function useLocalDate(): LocalDate {
  return useSyncExternalStore(subscribe, getLocalDateSnapshot);
}
