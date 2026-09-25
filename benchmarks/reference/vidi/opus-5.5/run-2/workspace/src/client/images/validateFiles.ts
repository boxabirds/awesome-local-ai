/**
 * Client-side checks before anything is uploaded (anchors: image.types, image.size_limit,
 * image.count_limit). A file's type is judged here by `File.type` (the Worker sniffs the
 * content again, and a file the browser cannot decode is refused with the type message).
 * Unsupported and too-large files are dropped first; of the rest, only the first
 * IMAGE_MAX_FILES_PER_ADD are kept. Never throws.
 */
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';
import { isAcceptedImageType } from '../../shared/image-format';

export type FileRejection = 'type' | 'size' | 'count';

/** Exact PRD wording of every message the image flows show. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const supported: File[] = [];
  for (const file of files) {
    if (!isAcceptedImageType(file.type)) rejections.add('type');
    else if (file.size > IMAGE_MAX_BYTES) rejections.add('size');
    else supported.push(file);
  }
  if (supported.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted: supported.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
