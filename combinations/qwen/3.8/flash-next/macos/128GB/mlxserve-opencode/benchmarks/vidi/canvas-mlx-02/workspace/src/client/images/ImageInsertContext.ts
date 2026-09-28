// The context an image object reaches its live insert state through (story 12).
//
// A board object is rendered by the registry with only the generic `ObjectProps`,
// but an image additionally needs upload progress, whether it can be retried, and
// the retry/remove actions - all of which live in `useImageInsert`, which is a hook
// BoardApp calls once. Rather than push six image-only props through every object
// type, BoardApp provides them here and only the image component reads them, exactly
// the way story 8's `UndoContext` reaches the undo controller into a note's editor.
//
// It is null outside a board (a bare ImageObject in a component test supplies its
// own props instead), so a reader must handle the absence.
import { createContext, useContext } from 'react';

export interface ImageInsertValue {
  /** live upload progress for this id (0..1), or undefined if none is running */
  progress(id: string): number | undefined;
  /** can this id's failed upload be retried (its File is still in memory)? */
  canRetry(id: string): boolean;
  /** is a retry upload currently in flight for this id? */
  isRetrying(id: string): boolean;
  /** re-upload a failed image; no-op if it cannot be */
  retry(id: string): void;
  /** delete the image object (any viewer can remove an unfinished one) */
  remove(id: string): void;
}

export const ImageInsertContext = createContext<ImageInsertValue | null>(null);

/** The board's image insert actions, or null when not inside a board. */
export function useImageInsertValue(): ImageInsertValue | null {
  return useContext(ImageInsertContext);
}
