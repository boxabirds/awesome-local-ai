import { createContext } from 'react';

/** What image objects need from the board beyond their own snapshot (story 12). */
export interface ImageContextValue {
  /** This tab's uploader identity: images whose uploaderId matches show the uploader's states. */
  identityId: string;
  /** Upload progress (0..1) of images this tab is uploading. */
  progress: ReadonlyMap<string, number>;
  /** Clock for the 'unfinished' state (ticks while an upload is pending). */
  now: number;
  editable: boolean;
  canRetry(id: string): boolean;
  retry(id: string): void;
  remove(id: string): void;
}

export const ImageContext = createContext<ImageContextValue>({
  identityId: '',
  progress: new Map(),
  now: 0,
  editable: false,
  canRetry: () => false,
  retry: () => {},
  remove: () => {},
});
