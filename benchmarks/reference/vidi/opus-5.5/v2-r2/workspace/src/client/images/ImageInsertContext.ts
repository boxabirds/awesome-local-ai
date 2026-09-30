import { createContext, useContext } from 'react';

/** What registered image objects need from the board's image insert flow (image.object). */
export interface ImageInsertInfo {
  /** This tab's uploader identity: the uploader sees progress, Retry and Remove. */
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
  /** Deletes the image placeholder (story 7 delete, one undo step). */
  remove(id: string): void;
}

export const ImageInsertContext = createContext<ImageInsertInfo>({
  identityId: '',
  progress: new Map(),
  canRetry: () => false,
  retry: () => false,
  remove: () => {},
});

export function useImageInsertInfo(): ImageInsertInfo {
  return useContext(ImageInsertContext);
}
