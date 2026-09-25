/**
 * Client-side checks before anything is uploaded (image.types, image.size_limit,
 * image.count_limit). The server checks type (by content) and size again; these checks only
 * spare the upload and explain the refusal right away.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/** Exact PRD wording of every message the image flows show. */
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
 * The files to add, in order, and why others were refused. Files of other types and files over
 * IMAGE_MAX_BYTES are refused; of the supported ones, only the first IMAGE_MAX_FILES_PER_ADD
 * are kept ('count').
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    if (!isAcceptedImageType(file.type)) {
      rejections.add('type');
    } else if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
    } else if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      rejections.add('count');
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejections };
}
