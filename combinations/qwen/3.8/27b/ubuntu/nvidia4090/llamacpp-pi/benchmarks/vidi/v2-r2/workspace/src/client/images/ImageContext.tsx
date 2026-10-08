/**
 * React context for image-specific state (story 12).
 *
 * Carries the per-image progress, uploader identity, retry state, and the
 * clock tick that drives the `unfinished` display status.
 */

import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react';

export interface ImageInsertContextValue {
  /** The current client's identity (to determine isUploader). */
  uploaderId: string;
  /** Upload progress per image id (fraction 0..1). */
  progress: ReadonlyMap<string, number>;
  /** Whether the file for `id` is still in memory (can retry). */
  canRetry: (id: string) => boolean;
  /** Retry a failed upload. */
  retry: (id: string) => void;
  /** Remove an image (calls deleteObjects). */
  remove: (id: string) => void;
  /** Ticking timestamp for displayStatus (updates every 30s while uploading). */
  now: number;
}

export const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);

/**
 * Hook to access the image insert context. Throws if used outside the provider.
 */
export function useImageInsertContext(): ImageInsertContextValue {
  const ctx = useContext(ImageInsertContext);
  if (ctx === null) {
    throw new Error('useImageInsertContext must be used within ImageInsertContext.Provider');
  }
  return ctx;
}

/**
 * Props to pass to the ImageInsertContext.Provider.
 */
export interface ImageInsertProviderProps {
  uploaderId: string;
  progress: ReadonlyMap<string, number>;
  canRetry: (id: string) => boolean;
  retry: (id: string) => void;
  remove: (id: string) => void;
  children: ReactNode;
}

/**
 * Provides the image insert context with a ticking `now` value.
 * The tick only runs when there are images in the 'uploading' status.
 */
export function ImageInsertProvider({
  uploaderId,
  progress,
  canRetry,
  retry,
  remove,
  children,
}: ImageInsertProviderProps): ReactNode {
  // Tick every 30 seconds (only when there's active progress to keep it
  // responsive; in practice we always tick so the unfinished state appears).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const value = useMemo<ImageInsertContextValue>(
    () => ({ uploaderId, progress, canRetry, retry, remove, now }),
    [uploaderId, progress, canRetry, retry, remove, now],
  );

  return (
    <ImageInsertContext.Provider value={value}>
      {children}
    </ImageInsertContext.Provider>
  );
}
