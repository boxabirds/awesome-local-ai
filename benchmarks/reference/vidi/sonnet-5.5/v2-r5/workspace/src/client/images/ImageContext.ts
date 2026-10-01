import { createContext } from 'react';

/** What image objects need from the board's insert hook (the generic object props carry none of it). */
export interface ImageContextValue {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
}

export const ImageContext = createContext<ImageContextValue>({
  identityId: '', progress: new Map(), canRetry: () => false, retry: () => false,
});
