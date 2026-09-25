// Client-side checks before anything is uploaded (story 12). The server decides the type again from the file's
// content; this only avoids uploading files that are sure to be refused.
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/** Toast texts, exactly as the PRD words them. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

export function isAcceptedImageType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Splits one add action's files into those to upload and the reasons others were refused. Unsupported types and
 * files over IMAGE_MAX_BYTES are refused; of the remaining supported files only the first IMAGE_MAX_FILES_PER_ADD
 * are kept.
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();
  for (const f of files) {
    if (!isAcceptedImageType(f.type)) rejections.add('type');
    else if (f.size > IMAGE_MAX_BYTES) rejections.add('size');
    else if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
    else accepted.push(f);
  }
  return { accepted, rejections };
}
