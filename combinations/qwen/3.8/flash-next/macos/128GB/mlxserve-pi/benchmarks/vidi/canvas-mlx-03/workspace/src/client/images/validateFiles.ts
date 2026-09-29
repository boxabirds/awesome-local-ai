// The client's decision about a pile of dropped, pasted or picked files (story 12).
//
// Three limits and one judgement, in the order the cheapness of the answer allows:
//
//   1. how many files there are, which is known before any file is looked at;
//   2. what the file says it is, which is known before any byte of it is read;
//   3. how long it is, which is known from the directory entry;
//   4. what it actually contains, which needs reading it — and is the only step that can
//      tell a photo from a file named like one.
//
// The order is the product's, not an optimisation: it decides which of two true things a
// user is told about the one file they are looking at, and the cheap one is the one they can
// act on without waiting for a read.
//
// The judgement in step 4 is a seam (`contentCheck`) for the same reason the board clock is
// one in `objects/image.ts`: the real thing is a browser's image decoder, and the tests —
// which are not all browsers — get to say what the decoder said.

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_LIMIT_MESSAGE,
} from '../../shared/config.ts';
import { sniffImageType } from '../../shared/image-format.ts';

/** Why a file was not added. The message is per reason, and two reasons share one message. */
export type FileRejection = 'type' | 'undecodable' | 'size' | 'count';

export interface RejectedFile {
  file: File;
  reason: FileRejection;
}

export interface ValidatedFiles {
  accepted: File[];
  rejected: RejectedFile[];
}

/**
 * What to say about each refusal.
 *
 * 'type' and 'undecodable' share a message because the user's action is the same either way —
 * this file is not a picture the board can take — and the difference between "the bytes are
 * not an image format" and "they are a format we know and a file we cannot open" is not
 * something a person can do anything about.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  undecodable: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: `Images must be ${IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
  count: `Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`,
  offline: "You're offline — images can be added when you reconnect.",
  rate: IMAGE_UPLOAD_LIMIT_MESSAGE,
};

/**
 * The sentence to show for a reason. 'undecodable' answers with the type message on purpose:
 * it is the same refusal seen from the other side, and a second toast about the same file
 * would be the board arguing with itself.
 */
export function rejectionMessage(reason: FileRejection | 'offline' | 'rate'): string {
  return REJECTION_MESSAGES[reason];
}

/**
 * File types we know are not images. The list exists so that a file reporting one of them is
 * refused on its word, without reading it: a PDF does not become less of a PDF by being large.
 */
export const KNOWN_NON_IMAGE_TYPES: readonly string[] = [
  'application/pdf',
  'application/postscript',
  'application/eps',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/json',
  'application/xml',
  'application/x-shockwave-flash',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'image/bmp',
  'image/vnd.microsoft.icon',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  'message/rfc822',
  'text/csv',
  'text/html',
  'text/plain',
  'text/rtf',
  'text/xml',
  'video/avi',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
];

/**
 * A claim that is not a claim. `File.type` is empty for a file the browser has no idea about,
 * and `application/octet-stream` is what a server hands out when it has no idea either;
 * neither says anything about the file, so neither can refuse it.
 */
export const UNCLAIMED_FILE_TYPES: readonly string[] = ['', 'application/octet-stream', 'binary/octet-stream'];

/**
 * Extensions of files that are not images, in the other direction: the claim is missing or
 * meaningless, and the only evidence left is the name the file came with.
 */
export const KNOWN_NON_IMAGE_EXTENSIONS: readonly string[] = [
  'pdf',
  'ps',
  'eps',
  'svg',
  'svgz',
  'zip',
  'gz',
  'tgz',
  'tar',
  'rar',
  '7z',
  'json',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'conf',
  'js',
  'ts',
  'tsx',
  'jsx',
  'css',
  'scss',
  'html',
  'htm',
  'md',
  'txt',
  'rtf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'csv',
  'ics',
  'exe',
  'dmg',
  'app',
  'pkg',
  'msi',
  'sh',
  'py',
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'flac',
  'aac',
  'mp4',
  'm4v',
  'mov',
  'avi',
  'mkv',
  'webm',
  'mpg',
  'mpeg',
  'heic',
  'heif',
  'avif',
  'bmp',
  'tif',
  'tiff',
  'ico',
  'icns',
  'psd',
  'sketch',
  'fig',
  'ai',
  'indd',
  'pages',
  'key',
  'eml',
  'msg',
];

/**
 * A file's bytes, by the modern route or the older one.
 *
 * `File.arrayBuffer()` is not in every browser that can otherwise handle pictures perfectly
 * well, and "this file cannot be opened" would be a lie told by a missing method.
 */
export function bytesOf(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'));
    reader.readAsArrayBuffer(file);
  });
}

/** The extension of a filename, lowercased, or '' when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function isAcceptedType(value: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(value);
}

/**
 * The client's own look at a file's bytes: the signature first, because it is free, and then
 * the browser's image decoder, because the signature is a claim and the decoder is the proof.
 *
 * The decoder is the whole reason a rename does not work: a PDF cut to look like the start of
 * a PNG passes the signature and fails here, and a PNG truncated by a half-finished download
 * fails here and nowhere else. Where there is no decoder — a test, a Worker — the signature is
 * the best available answer, which is why the tests that care about undecodable files bring
 * their own answer instead (see the `contentCheck` seam).
 */
export async function defaultContentCheck(bytes: Uint8Array): Promise<boolean> {
  if (sniffImageType(bytes) === null) return false;
  const decode = (globalThis as { createImageBitmap?: unknown }).createImageBitmap as
    | ((blob: Blob) => Promise<unknown>)
    | undefined;
  if (typeof decode !== 'function') return true;
  try {
    await decode.call(globalThis, new Blob([bytes.slice().buffer as ArrayBuffer]));
    return true;
  } catch {
    return false;
  }
}

export type ContentCheck = (bytes: Uint8Array) => Promise<boolean>;

/** How big a picture is, as reported by whatever opened it. */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * How big a picture whose bytes could not be opened is placed: a square, at the largest box a
 * picture is ever placed into.
 */
export const IMAGE_UNKNOWN_PLACE_SIZE = IMAGE_MAX_PLACE_SIZE_WORLD;

/**
 * The seam that opens a file as a picture. In a browser this is `createImageBitmap`; a test
 * says what the decoder answered, because the size a placeholder is created at comes from here
 * and a test cannot depend on a real decoder agreeing about a fixture.
 */
export type BitmapDecoder = (file: File) => Promise<ImageDimensions>;

export const browserBitmapDecoder: BitmapDecoder = async (file) => {
  const decode = (globalThis as { createImageBitmap?: unknown }).createImageBitmap as
    | ((source: File) => Promise<{ width: number; height: number }>)
    | undefined;
  if (typeof decode !== 'function') throw new Error('no image decoder is available');
  const bitmap = await decode(file);
  return { width: bitmap.width, height: bitmap.height };
};

/**
 * The size of a file's picture, or a square when nothing could open it.
 *
 * The fallback is what lets the flow go on rather than stop: a placeholder has to be created
 * before the bytes are uploaded, and the one thing knowable about an unopened picture is that
 * some square will do for it.
 */
export async function dimensionsOf(
  file: File,
  decode: BitmapDecoder = browserBitmapDecoder,
): Promise<ImageDimensions> {
  try {
    const size = await decode(file);
    if (size.width > 0 && size.height > 0) return size;
  } catch {
    // no decoder, or a file that is not a picture after all: the square is the answer
  }
  return { width: IMAGE_UNKNOWN_PLACE_SIZE, height: IMAGE_UNKNOWN_PLACE_SIZE };
}

/**
 * Sort a pile of files into what can be added and what cannot, with a reason for each.
 *
 * The returned `accepted` Files are the ones passed in, not copies: a rejected file is
 * dropped and an accepted one is uploaded as it came.
 */
export async function validateFiles(
  files: readonly File[],
  contentCheck: ContentCheck = defaultContentCheck,
): Promise<ValidatedFiles> {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const [index, file] of files.entries()) {
    // Position is the one fact here that costs nothing and needs no trust in the file.
    if (index >= IMAGE_MAX_FILES_PER_ADD) {
      rejected.push({ file, reason: 'count' });
      continue;
    }

    const claim = (file.type ?? '').trim().toLowerCase();
    if (isAcceptedType(claim)) {
      // The claim agrees with the product; it is still only a claim, so it is not believed.
    } else if (!UNCLAIMED_FILE_TYPES.includes(claim) && KNOWN_NON_IMAGE_TYPES.includes(claim)) {
      rejected.push({ file, reason: 'type' });
      continue;
    } else if (KNOWN_NON_IMAGE_EXTENSIONS.includes(extensionOf(file.name ?? ''))) {
      // No usable claim, but the name is one we know, and a name is evidence when nothing
      // better is on offer.
      rejected.push({ file, reason: 'type' });
      continue;
    }

    // Length comes from the directory entry, so it is free; content costs a read, and a file
    // already refused for its length is not owed one.
    if (file.size > IMAGE_MAX_BYTES) {
      rejected.push({ file, reason: 'size' });
      continue;
    }

    let ok = false;
    try {
      const bytes = new Uint8Array(await bytesOf(file));
      ok = await contentCheck(bytes);
    } catch {
      // A file that cannot be read is a file that cannot be uploaded, whatever it is.
      ok = false;
    }
    if (ok) accepted.push(file);
    else rejected.push({ file, reason: 'undecodable' });
  }

  return { accepted, rejected };
}
