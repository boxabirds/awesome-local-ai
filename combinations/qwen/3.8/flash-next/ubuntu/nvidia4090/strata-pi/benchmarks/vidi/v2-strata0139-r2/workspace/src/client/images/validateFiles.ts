/**
 * `image.insert` — what the browser refuses before any byte is uploaded.
 *
 * The three rules a person can trip on *before* a file reaches the Worker
 * (type, size, count) are checked here, in one pass, and each one produces a
 * message rather than an exception:
 *
 *   - a file whose type is not one of `IMAGE_ACCEPTED_TYPES` is refused, and the
 *     accepted files in the same drop still go through (`image.types`);
 *   - a file over `IMAGE_MAX_BYTES` is refused on its own (`image.size_limit`);
 *   - the first `IMAGE_MAX_FILES_PER_ADD` **supported** files are kept and the
 *     rest are skipped with a message (`image.count_limit`).
 *
 * `File.type` is the cheap first filter — it is what Chromium derives from the
 * file, and it is enough for a PDF or a video. It is not the last word: the type
 * a name claims is checked against the file's actual content by decoding it
 * (`createImageBitmap`) before anything is placed, and by magic bytes on the
 * server (`src/shared/image-format.ts`). A file that only *looks* like an image
 * therefore never becomes a board object either way.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from "../../shared/config";

export type FileRejection = "type" | "size" | "count";

export interface FileValidation {
  /** The files this action may add, in the order they arrived, at most `IMAGE_MAX_FILES_PER_ADD`. */
  readonly accepted: File[];
  /** Which rules refused something, so the caller can show one message per rule. */
  readonly rejections: Set<FileRejection>;
}

/** The exact PRD wording, keyed by the rule that produced it. */
export const REJECTION_MESSAGES: Record<FileRejection | "offline", string> = {
  type: "Only PNG, JPEG, GIF and WebP images can be added.",
  size: "Images must be 10 MB or smaller.",
  count: "Only 20 images can be added at once.",
  offline: "You're offline \u2014 images can be added when you reconnect.",
};

/** True when a file's own type is one this board accepts. */
export function isAcceptedFileType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

export function validateFiles(files: readonly File[]): FileValidation {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();

  for (const file of files ?? []) {
    if (!file) continue;
    if (!isAcceptedFileType(file.type ?? "")) {
      rejections.add("type");
      continue;
    }
    if (typeof file.size === "number" && file.size > IMAGE_MAX_BYTES) {
      rejections.add("size");
      continue;
    }
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      // Everything supported after the limit is skipped, but the rule is only
      // reported once.
      rejections.add("count");
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}

/** The messages for a validation, in a stable order (type, size, count). */
export function rejectionMessages(validation: FileValidation): string[] {
  const ordered: FileRejection[] = ["type", "size", "count"];
  return ordered.filter((kind) => validation.rejections.has(kind)).map((kind) => REJECTION_MESSAGES[kind]);
}
