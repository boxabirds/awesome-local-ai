import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

// Exact PRD strings. 'offline' is not a per-file rejection but shares the
// message map so every add path shows the same text.
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect."
};

// Pre-upload screen: the declared MIME type must be accepted and the size
// within the limit. Files beyond IMAGE_MAX_FILES_PER_ADD are cut with a
// count rejection; content-level judging (renamed PDFs, corrupt data)
// happens at decode and on the server.
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const rejections = new Set<FileRejection>();
  const valid: File[] = [];
  for (const file of files) {
    const typeOk = (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
    const sizeOk = file.size <= IMAGE_MAX_BYTES;
    if (typeOk && sizeOk) {
      valid.push(file);
    } else {
      if (!typeOk) rejections.add('type');
      if (!sizeOk) rejections.add('size');
    }
  }
  if (valid.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    return { accepted: valid.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
  }
  return { accepted: valid, rejections };
}
