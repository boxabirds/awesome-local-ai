import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

// Story 12: client-side validation of files before any upload happens
// (design image.insert). The server independently re-checks by content; a
// file that passes here but is disguised still fails server-side or at
// decode time.

export type FileRejection = 'type' | 'size' | 'count';

export interface ValidatedFiles {
  accepted: File[];
  rejections: Set<FileRejection>;
}

const ACCEPTED: ReadonlySet<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

// Exact PRD wording (image.types, image.size_limit, image.count_limit,
// image.offline).
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect."
};

export function validateFiles(files: readonly File[]): ValidatedFiles {
  const rejections = new Set<FileRejection>();
  const valid: File[] = [];
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    valid.push(file);
  }
  const accepted = valid.slice(0, IMAGE_MAX_FILES_PER_ADD);
  if (valid.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted, rejections };
}
