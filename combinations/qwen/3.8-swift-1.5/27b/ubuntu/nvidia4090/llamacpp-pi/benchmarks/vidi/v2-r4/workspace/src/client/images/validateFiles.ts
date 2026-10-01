import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/**
 * Exact PRD messages for each rejection class (and the offline gate).
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

export interface ValidateFilesResult {
  /** Files accepted, in original order, at most IMAGE_MAX_FILES_PER_ADD. */
  accepted: File[];
  /** Which rejection classes occurred (for toasts). */
  rejections: Set<FileRejection>;
}

function isAcceptedType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Client-side pre-upload validation: accepted type (by File.type), size limit
 * and per-action count limit. Pure — no uploads, no decoding.
 *
 * Filters are applied in order (type → size → count); each class that removes
 * at least one file is recorded in `rejections` so the UI can toast it.
 */
export function validateFiles(files: readonly File[]): ValidateFilesResult {
  const rejections = new Set<FileRejection>();

  let accepted = files.filter((f) => isAcceptedType(f.type));
  if (accepted.length !== files.length) rejections.add('type');

  const sized = accepted.filter((f) => f.size <= IMAGE_MAX_BYTES);
  if (sized.length !== accepted.length) rejections.add('size');
  accepted = sized;

  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted = accepted.slice(0, IMAGE_MAX_FILES_PER_ADD);
  }

  return { accepted, rejections };
}
