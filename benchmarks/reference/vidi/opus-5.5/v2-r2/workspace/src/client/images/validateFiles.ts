import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';
import { isAcceptedImageType } from '../../shared/image-format';

export type FileRejection = 'type' | 'size' | 'count';

/** Exact PRD wording of every refusal (image.types, image.size_limit, image.count_limit, image.offline). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Browser-side checks before anything is uploaded: files that are not PNG,
 * JPEG, GIF or WebP ('type') or larger than IMAGE_MAX_BYTES ('size') are
 * refused; of the supported files only the first IMAGE_MAX_FILES_PER_ADD are
 * kept ('count'). The type here comes from the browser; the content is checked
 * again by decoding (client) and by magic bytes (server).
 */
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

/** Toast lines for a set of rejections, in a stable order. */
export function rejectionMessages(rejections: ReadonlySet<FileRejection>): string[] {
  return (['type', 'size', 'count'] as const).filter((r) => rejections.has(r)).map((r) => REJECTION_MESSAGES[r]);
}
