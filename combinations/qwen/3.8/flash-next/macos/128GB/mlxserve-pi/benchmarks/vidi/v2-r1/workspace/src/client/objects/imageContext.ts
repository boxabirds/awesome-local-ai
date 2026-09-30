// The per-tab answers an image object needs but the document cannot give it.
//
// The document says what an image *is* (`image.model`): its status, its key, who
// uploaded it. It cannot say what is true only of *this* tab right now — whether the
// person looking is the one who uploaded it, how far *their* upload has got, whether
// *their* copy of the file is still in memory to be retried, and what the clock reads
// for deciding `unfinished`. All of that lives in `useImageInsert`, which sits at the
// board, while the object is rendered deep in the world layer.
//
// This context is the one hop between them. `Board` puts `useImageInsert`'s live
// values in it once; the registry's `image` entry reads it and works out the five
// per-viewer props (`isUploader`, `progress`, `canRetry`, `now`, and the `onRetry` /
// `onRemove` callbacks) to hand to the pure `ImageObject`. It is empty by default so
// an image rendered outside a board — a component test of the states on their own —
// falls back to a plain viewer with nothing to retry, rather than throwing.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Image object rendering".
import { createContext } from 'react';

export interface ImageObjectContextValue {
  /** This tab's id, compared to the object's `uploaderId` for `isUploader`. */
  localId: string;
  /** Upload progress (0–1) by object id, from the tab that is uploading. */
  progress: ReadonlyMap<string, number>;
  /** Retry is possible while this tab still holds the object's file. */
  canRetry(id: string): boolean;
  /** Re-upload this tab's file for `id`. */
  retry(id: string): void;
  /** Delete the placeholder object (story 7's `deleteObjects`, one undo step). */
  remove(id: string): void;
  /** A clock in ms, re-rendered every so often while any upload runs. */
  now: number;
}

/** Nothing but a plain viewer: an image off its board is `ready`-or-grey, never a
 * half-shown upload with controls it cannot act on. */
export const EMPTY_IMAGE_CONTEXT: ImageObjectContextValue = {
  localId: '',
  progress: new Map(),
  canRetry: () => false,
  retry: () => {},
  remove: () => {},
  now: 0,
};

export const ImageObjectContext = createContext<ImageObjectContextValue>(EMPTY_IMAGE_CONTEXT);
