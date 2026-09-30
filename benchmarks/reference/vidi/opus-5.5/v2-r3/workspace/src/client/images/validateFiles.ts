// Client-side checks before anything is uploaded (story 12, image.insert):
// count, type and size, with the PRD's exact messages.
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** Message order when one action has several kinds of refused files. */
export const REJECTION_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

const ACCEPTED: ReadonlySet<string> = new Set(IMAGE_ACCEPTED_TYPES);

/**
 * Splits one add action's files into those to add and the reasons others were
 * refused. Unsupported and oversized files are dropped first; of the supported
 * files only the first IMAGE_MAX_FILES_PER_ADD are kept. The declared type is
 * a first filter only: the insert flow also checks the content (magic bytes).
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const supported: File[] = [];
  for (const f of files) {
    if (!ACCEPTED.has(f.type)) rejections.add('type');
    else if (f.size > IMAGE_MAX_BYTES) rejections.add('size');
    else supported.push(f);
  }
  if (supported.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted: supported.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
