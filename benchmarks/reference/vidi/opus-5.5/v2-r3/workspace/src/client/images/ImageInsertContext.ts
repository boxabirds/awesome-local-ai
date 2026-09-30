import { createContext } from 'react';

/**
 * What image objects need from the board's insert flow (story 12): who this
 * tab is, its upload progress and Retry, plus Remove and the status clock.
 */
export interface ImageInsertContextValue {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
  remove(id: string): void;
  /** Clock for `displayStatus`, re-evaluated every IMAGE_STATUS_TICK_MS while anything uploads. */
  now: number;
}

export const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);
