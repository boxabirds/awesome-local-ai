// Client-side checks before anything is uploaded (story 12): type, size and count per add action.
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/** The exact messages shown (PRD). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const ACCEPTED: ReadonlySet<string> = new Set(IMAGE_ACCEPTED_TYPES);

/**
 * Splits one add action's files into those to add and the reasons others were refused. Files of
 * other types and files over IMAGE_MAX_BYTES are refused; of the remaining files only the first
 * IMAGE_MAX_FILES_PER_ADD are kept. (The content is checked again when decoding and on upload.)
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) rejections.add('type');
    else if (file.size > IMAGE_MAX_BYTES) rejections.add('size');
    else if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
    else accepted.push(file);
  }
  return { accepted, rejections };
}
