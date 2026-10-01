import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const isAcceptedType = (t: string) => (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(t);

/** Type and size are judged per file; the count limit then keeps the first IMAGE_MAX_FILES_PER_ADD survivors. */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  let accepted = files.filter((f) => {
    if (!isAcceptedType(f.type)) { rejections.add('type'); return false; }
    if (f.size > IMAGE_MAX_BYTES) { rejections.add('size'); return false; }
    return true;
  });
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted = accepted.slice(0, IMAGE_MAX_FILES_PER_ADD);
  }
  return { accepted, rejections };
}
