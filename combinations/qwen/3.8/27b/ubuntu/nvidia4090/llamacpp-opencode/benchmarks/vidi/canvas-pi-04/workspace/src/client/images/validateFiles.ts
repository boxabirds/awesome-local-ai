// Story 12: client-side file validation (anchor: image.insert).
//
// Pure validation of the files a drop/paste/pick produced, BEFORE any upload:
// apply the count limit (first IMAGE_MAX_FILES_PER_ADD), the type filter
// (accepted MIME types only) and the size limit (<= IMAGE_MAX_BYTES). Returns
// the files that may be uploaded plus the set of rejection reasons, so the
// caller can show the matching toast(s). The server re-checks type (by content
// sniffing) and size, so this is a fast client-side pre-filter, not the source
// of truth (image.types / image.size_limit / image.count_limit).

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

/** The reasons a file can be refused (image.insert). */
export type FileRejection = 'type' | 'size' | 'count';

export interface ValidateResult {
  /** Files that pass every check and may be uploaded. */
  accepted: File[];
  /** Which rejection classes occurred (for toasts); empty when all accepted. */
  rejections: Set<FileRejection>;
}

function isAcceptedType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Validate a batch of files. The count limit applies first (only the first
 * IMAGE_MAX_FILES_PER_ADD are considered; the rest raise `count`); each
 * considered file is then checked for type and size. A file is accepted only
 * when it passes both.
 */
export function validateFiles(files: readonly File[]): ValidateResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  const considered = files.slice(0, IMAGE_MAX_FILES_PER_ADD);
  if (files.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  for (const file of considered) {
    if (!isAcceptedType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejections };
}

/**
 * Toast wording, matching the PRD alternate-flow messages exactly. `offline`
 * and `rate` are not file rejections but are surfaced through the same toast
 * (image.offline / image.rate_limit).
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};
