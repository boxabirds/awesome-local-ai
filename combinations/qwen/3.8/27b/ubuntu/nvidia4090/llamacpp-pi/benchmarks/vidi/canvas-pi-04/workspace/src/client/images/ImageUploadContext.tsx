// Story 12: the per-image upload state bridge (anchor: image.uploading /
// image.upload_failure).
//
// The uploader keeps an in-memory map of id → File so a failed upload can be
// retried, and tracks each upload's progress locally (NOT in the shared doc —
// progress never writes to the board on every tick). ImageObject reads this
// context to render the progress bar (to the uploader), offer Retry (only when
// the file is still in memory) and Remove, and hide Retry after a reload (the
// map is empty). `useImageInsert` is the provider.

import { createContext, useContext } from 'react';

/** The upload state for one image (all optional: absent when not uploading). */
export interface ImageUploadInfo {
  /** 0..1 upload progress, present while this uploader is uploading it. */
  progress?: number;
  /** True when the uploader still holds the file (so Retry can re-upload). */
  canRetry: boolean;
}

/** The API an ImageObject uses to drive its uploading/failed affordances. */
export interface ImageUploadApi {
  /** The upload info for an object id, or undefined when there is none. */
  info(id: string): ImageUploadInfo | undefined;
  /** Re-upload a failed image (only meaningful when info(id).canRetry). */
  retry(id: string): void;
  /** Delete an image object (story 7 delete). */
  remove(id: string): void;
}

export const ImageUploadContext = createContext<ImageUploadApi | null>(null);

/** The current image-upload API, or null when no uploader is wired up. */
export function useImageUpload(): ImageUploadApi | null {
  return useContext(ImageUploadContext);
}
