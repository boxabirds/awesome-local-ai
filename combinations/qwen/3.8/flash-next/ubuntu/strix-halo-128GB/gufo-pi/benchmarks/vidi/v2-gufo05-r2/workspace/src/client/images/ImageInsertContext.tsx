/**
 * Story 12: React context that makes image insert state available to ImageObject
 * components rendered through the registry.
 */

import { createContext, useContext, type ReactNode } from 'react';

export interface ImageInsertContextValue {
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  remove(id: string): void;
  /** Current timestamp, updated every 30 seconds to detect stale uploads. */
  now: number;
}

const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);

export function ImageInsertProvider({
  value,
  children,
}: {
  value: ImageInsertContextValue;
  children: ReactNode;
}) {
  return <ImageInsertContext.Provider value={value}>{children}</ImageInsertContext.Provider>;
}

export function useImageInsertContext(): ImageInsertContextValue | null {
  return useContext(ImageInsertContext);
}
