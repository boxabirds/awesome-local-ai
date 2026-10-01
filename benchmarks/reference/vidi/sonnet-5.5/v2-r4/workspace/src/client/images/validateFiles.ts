import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** Type and size are checked per file; of the files that pass, only the first IMAGE_MAX_FILES_PER_ADD are kept. */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const ok: File[] = [];
  for (const f of files) {
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(f.type)) rejections.add('type');
    else if (f.size > IMAGE_MAX_BYTES) rejections.add('size');
    else ok.push(f);
  }
  if (ok.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted: ok.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
