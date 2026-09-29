/**
 * Client-side validation of files a user tries to add (story 12, image.insert).
 *
 * Type and size are refused *before* anything is uploaded, so a 12 MB video or a
 * PDF never reaches the network. The count limit keeps the first
 * IMAGE_MAX_FILES_PER_ADD files and explains what was skipped. The worker still
 * sniffs content — a renamed PDF that passes here is rejected by the server or
 * by the client's decode step.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export interface ValidationResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

/** Exact user-facing wording (PRD image.types / image.size_limit / image.count_limit). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: 'You’re offline — images can be added when you reconnect.',
  rate: 'You’re adding images too quickly. Wait a minute and try again.',
};

const ACCEPTED: ReadonlySet<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

/** Is this MIME type something the board can show? */
export function isAcceptedFileType(type: string): boolean {
  return ACCEPTED.has(type);
}

/**
 * Split files into accepted and rejected reasons.
 *
 * Order: type, then size, then count — "more than 20 *supported* files" is what
 * the count message is about, and an unsupported file never counts toward it.
 * Never throws; every reason is reported once.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const valid: File[] = [];

  for (const file of files) {
    if (!isAcceptedFileType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    valid.push(file);
  }

  if (valid.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    return { accepted: valid.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
  }
  return { accepted: valid, rejections };
}

/** Files that look like images, taken from a DataTransfer or ClipboardEvent. */
export function filesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  if (typeof transfer.files === 'object' && transfer.files !== null) {
    return Array.from(transfer.files);
  }
  return [];
}
