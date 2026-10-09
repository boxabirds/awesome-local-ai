import { createContext, useContext } from 'react';

// Story 12: ImageObject needs the insert session's per-image progress and the
// uploader's in-memory retry state, both of which live in useImageInsert on
// the viewport. Null when no insert session exists (tests render ImageObject
// directly or with a hand-made value).
export interface ImageInsertContextValue {
  getProgress(id: string): number | null;
  retry(id: string): void;
  canRetry(id: string): boolean;
}

export const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);

export function useImageInsertContext(): ImageInsertContextValue | null {
  return useContext(ImageInsertContext);
}
