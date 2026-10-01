import { createContext, useContext } from 'react';

/** What ImageObject needs from the board's image insertion (uploader progress, retry); defaults are inert. */
export interface ImageInsertContextValue {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
}

export const ImageInsertContext = createContext<ImageInsertContextValue>({
  identityId: '',
  progress: new Map(),
  canRetry: () => false,
  retry: () => false,
});

export const useImageInsertContext = () => useContext(ImageInsertContext);
