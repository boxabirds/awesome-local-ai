import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES, IMAGE_UPLOAD_STALE_MS } from '../../shared/config';
import { sniffImageType } from '../../shared/image-format';
import {
  abandonImagePlaceholders,
  createImagePlaceholders,
  type ImageSnap,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type PlacementItem,
} from '../../shared/objects/image';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { showToast } from '../ui/Toast';
import type { UndoController } from '../board/undo';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';

/**
 * Adding images to the board: drop, paste, and the Image tool's picker
 * (`image.drop`, `image.paste`, `image.pick`).
 *
 * Three doors, one path. Each door hands over its files, and everything after that is
 * shared: refuse what must not be added and say why in the PRD's own words, measure
 * what is left, place the whole action in one transaction so it is one undo step, then
 * upload each file and let the object report how it went. The placeholders exist before
 * a single byte is sent, which is what lets everyone else on the board see the shape of
 * what is coming (PRD image.uploading) — and what makes an abandoned upload somebody
 * else's problem to read, which is why `unfinished` is derived from the clock instead of
 * trusted to a flag.
 *
 * The hook never throws and never returns an error value: everything that can go wrong
 * is either a toast or a state on the object, because a person who dropped 3 files and
 * had 2 of them refused needs to see the 2 that came through.
 */

/** How often the clock is re-read while something is still uploading (PRD image.unfinished). */
const IMAGE_CLOCK_TICK_MS = 30_000;

/** Where an action puts its row of images, and what its anchor point means. */
interface PlacementTarget {
  /** Screen-space point: the drop point, or the middle of the visible board area. */
  point: Point;
  anchor: 'top-left' | 'centre';
}

export interface ImageInsertOptions {
  readonly doc: Y.Doc;
  readonly boardId: string;
  readonly camera: Camera;
  /** Story 3's state: an upload only starts while the board is really connected. */
  readonly connection: ConnectionState;
  /** This tab's identity, recorded as the uploader so only they are offered Retry. */
  readonly identityId: string;
  /** Story 8's history: one add is one step, so its ends are marked around the transaction. */
  readonly undo?: UndoController;
}

export interface ImageInsert {
  /** `dragover`/`dragenter`: says the drop is allowed, for file drags only. */
  onDragOver(e: DragEvent): void;
  /** `drop`: the files land where the pointer was over the board. */
  onDrop(e: DragEvent): void;
  /** `paste`: clipboard images, unless the keyboard belongs to a text field. */
  onPaste(e: ClipboardEvent): void;
  /** The Image button or the I key: the system picker, filtered to accepted types. */
  openPicker(): void;
  /** Upload progress per object id, uploader's tab only (PRD image.uploading). */
  readonly progress: ReadonlyMap<string, number>;
  /** Upload the same file again. False when this tab no longer has the file. */
  retry(id: string): boolean;
  /** Whether Retry can be offered: the bytes are still here, so a reload costs the retry. */
  canRetry(id: string): boolean;
}

/** Is this drag carrying files (as opposed to text or a link)? */
export function carriesFiles(e: DragEvent | DragEventLike): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/** The bits of a drag event this module reads, so a test can hand over a plain object. */
export interface DragEventLike {
  readonly dataTransfer?: { readonly types?: readonly string[] } | null;
}

/** `connected` and `confirmed` are the only states a board can be edited in *and*
 *  delivered through: the document may not reach anyone else otherwise, and an image
 *  whose bytes cannot be reported back as ready would sit as a placeholder forever. */
function isLive(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

/** The middle of the visible board area, in screen coordinates. The viewport is the
 *  window (`.board-viewport` is `inset: 0`), which is what `BoardViewport` measures too. */
function viewCentre(): Point {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** A file's first bytes, for the same sniff the server will apply to the whole body. */
async function headOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer());
}

/** What a file that may be uploaded is: its dimensions and the type its bytes claim. */
interface Measured {
  readonly file: File;
  readonly width: number;
  readonly height: number;
  readonly contentType: string;
}

/**
 * A file is measurable if its bytes are an accepted image *and* it decodes.
 *
 * The sniff is the server's, run here first so 10 MB of a document is never pushed at a
 * server that was only ever going to answer 415; the decode is `createImageBitmap`,
 * which is what makes a truncated PNG a refusal rather than a 0×0 image on the board
 * (PRD image.types, and the design's decode-failure path).
 */
async function measure(file: File): Promise<Measured | null> {
  try {
    const sniffed = sniffImageType(await headOf(file));
    if (!sniffed) return null;
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
    if (size.width <= 0 || size.height <= 0) return null;
    return { file, width: size.width, height: size.height, contentType: sniffed };
  } catch {
    return null; // a browser that would not decode it is not going to display it either
  }
}

export function useImageInsert(options: ImageInsertOptions): ImageInsert {
  const { doc, boardId, camera, identityId, undo } = options;

  // The latest connection and camera, read at the moment something is dropped: a
  // handler attached once must not answer from the state of the render that attached it.
  const liveRef = useRef({ connection: options.connection, camera });
  liveRef.current = { connection: options.connection, camera };

  /** id → the bytes, so Retry needs no second upload of a file this tab already has. */
  const filesRef = useRef(new Map<string, File>());
  /** Uploads this tab is running, so leaving the board can stop them. */
  const runningRef = useRef(new Map<string, { handle: UploadHandle; aborted: boolean }>());
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());

  const setFraction = useCallback((id: string, fraction: number | null) => {
    setProgress((previous) => {
      const next = new Map(previous);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  // Nothing is left running when this board goes away: an upload that would report a
  // result to a document nobody is looking at is only a way to write an image the
  // person who left never asked to keep. The object stays `uploading` and becomes
  // `unfinished` after IMAGE_UPLOAD_STALE_MS, which is exactly what happened (PRD
  // image.unfinished).
  useEffect(() => {
    const running = runningRef.current;
    return () => {
      for (const entry of running.values()) {
        entry.aborted = true;
        entry.handle.abort();
      }
      running.clear();
    };
  }, []);

  /** Forget the progress, and — when there is nothing to send any more — the bytes. */
  const doneUploading = useCallback(
    (id: string, keepForRetry: boolean) => {
      setFraction(id, null);
      // The file is kept while it is still worth sending: a failed upload is retried
      // with the bytes this tab already has (PRD image.upload_failure), and they are only
      // thrown away once the picture exists or the placeholder has been taken back.
      if (!keepForRetry) filesRef.current.delete(id);
    },
    [setFraction],
  );

  /**
   * One upload, and what its answer means for the object.
   *
   * `ok` marks it ready with the key the server wrote; a `413`/`415` — which the
   * browser and the sniff above should both have caught — takes the placeholder back
   * and shows the same sentence the file would have been refused with, because an
   * image that storage will not keep was never added; anything else leaves the
   * placeholder as `failed` so the person can Retry or Remove it (PRD image.upload_failure).
   */
  const startUpload = useCallback(
    async (id: string, file: File): Promise<void> => {
      const handle = uploadImage(boardId, file, (fraction) => setFraction(id, fraction));
      const entry = { handle, aborted: false };
      runningRef.current.set(id, entry);
      setFraction(id, 0);
      const result = await handle.promise;
      runningRef.current.delete(id);
      if (entry.aborted) return; // this tab stopped caring; leave the object as it is

      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
        doneUploading(id, false);
        return;
      }
      if (result.status === 413 || result.status === 415) {
        abandonImagePlaceholders(doc, [id]);
        doneUploading(id, false);
        showToast(REJECTION_MESSAGES[result.status === 413 ? 'size' : 'type']);
        return;
      }
      markImageFailed(doc, id);
      // The bytes stay: Retry is this tab's, and this tab is the one holding them.
      doneUploading(id, true);
    },
    [boardId, doc, doneUploading, setFraction],
  );

  /**
   * The shared path: validate, measure, place, upload. Returns once the placeholders
   * exist; the uploads themselves are left running.
   */
  const addFiles = useCallback(
    async (incoming: readonly File[], target: PlacementTarget): Promise<void> => {
      if (!isLive(liveRef.current.connection)) {
        showToast(REJECTION_MESSAGES.offline); // nothing is added, nothing is uploaded
        return;
      }
      const { accepted, rejections } = validateFiles(incoming);
      const refused = new Set<FileRejection>(rejections);

      const measured = await Promise.all(accepted.map(measure));
      const usable = measured.filter((m): m is Measured => m !== null);
      // A file that passed the name and the size but would not decode was refused for the
      // same reason as one whose bytes were never an image, and gets the same sentence —
      // once, not a second time.
      if (usable.length < measured.length) refused.add('type');
      // The PRD's sentences, in a fixed order, one toast each, however many files it took
      // and whichever of the two checks refused them.
      for (const reason of ['type', 'size', 'count'] as const satisfies readonly FileRejection[]) {
        if (refused.has(reason)) showToast(REJECTION_MESSAGES[reason]);
      }
      if (usable.length === 0) return;

      const { camera: current } = liveRef.current;
      const point = screenToWorld(current, target.point);
      const rects = layoutRow(
        // A placement that came out unusable is left out of the row by `layoutRow`, so
        // no image is drawn at 0 width.
        usable.map((m) => placementSize(m.width, m.height)),
        point,
        target.anchor,
      );
      const items: PlacementItem[] = usable.flatMap((m, i) => {
        const rect = rects[i];
        return rect ? [{ rect, naturalWidth: m.width, naturalHeight: m.height, contentType: m.contentType }] : [];
      });

      // One drop, one undo step — including the `ready` updates that arrive later,
      // which are written under an origin the history does not track (PRD undo.steps).
      undo?.boundary();
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());
      undo?.boundary();

      ids.forEach((id, i) => {
        const item = items[i];
        const file = usable[i]?.file;
        if (!item || !file) return;
        filesRef.current.set(id, file);
        void startUpload(id, file);
      });
    },
    [doc, identityId, startUpload, undo],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    // Only a file drag is answered: a text drag is left to whatever it was doing, and
    // answering it would advertise a drop the board would then refuse.
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // otherwise the browser navigates to the first file
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
      void addFiles(files, {
        // The drop point, in the viewport's own coordinates: the first image's top-left
        // corner goes there (PRD image.drop).
        point: { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
        anchor: 'top-left',
      });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // A paste that a note, a text object, a label or an input is holding belongs to
      // that editor, and nothing is added (PRD image.paste).
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return; // a text paste is not this story's business
      e.preventDefault();
      void addFiles(files, { point: viewCentre(), anchor: 'centre' });
    },
    [addFiles],
  );

  /**
   * The system file picker, filtered to the accepted types, and *built here*: the
   * picker belongs to this action, so no invisible input sits on the board waiting for
   * a click, and the accept list stays next to the code that enforces it. A cancelled
   * picker answers nothing, which is the same as adding nothing.
   */
  const openPicker = useCallback(() => {
    if (!isLive(liveRef.current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPT_ATTRIBUTE;
    const finish = (kind: 'change' | 'cancel') => {
      const files = kind === 'change' ? Array.from(input.files ?? []) : [];
      input.remove();
      if (files.length === 0) return; // cancelled, or a picker that answered with nothing
      void addFiles(files, { point: viewCentre(), anchor: 'centre' });
    };
    input.addEventListener('change', () => finish('change'));
    // A dismissed picker says so (in Chromium, at least) rather than staying silent, and
    // either way the input has no further use.
    input.addEventListener('cancel', () => finish('cancel'));
    // The input has to stay in the document while the picker is open — one removed
    // straight after `click()` is an input the browser may already have forgotten.
    document.body.appendChild(input);
    input.click();
  }, [addFiles]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (!file) return false; // the bytes went away with the tab that had them
      if (!isLive(liveRef.current.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return false;
      }
      // Back to `uploading`, with the clock restarted so the wait for "didn't finish"
      // is measured from this attempt (PRD image.upload_failure).
      if (!markImageRetrying(doc, id, Date.now())) {
        filesRef.current.delete(id);
        return false;
      }
      void startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  return { onDragOver, onDrop, onPaste, openPicker, progress, retry, canRetry };
}

/**
 * `accept` for the file picker: exactly the types the product adds, spelled out of the
 * same setting the browser check and the server sniff use, so the picker cannot offer a
 * type that would then be refused.
 */
export const IMAGE_ACCEPT_ATTRIBUTE = IMAGE_ACCEPTED_TYPES.join(',');

/**
 * A clock for the board: `Date.now()` at render, re-read every 30 s while any image is
 * still uploading (and once when the last one finishes, so the tick stops with it).
 * "Uploading…" turning into "Image upload didn't finish" is a fact about time, not about
 * the document, so nothing arrives to cause a re-render — this is what causes it.
 */
export function useUploadClock(images: readonly ImageSnap[]): number {
  const [now, setNow] = useState(() => Date.now());
  // Nothing to wait for once every upload has either finished or been given up on: an
  // `unfinished` image does not change again until somebody acts on it, so the board is
  // not kept awake for it.
  const ticking = images.some(
    (image) => image.status === 'uploading' && now - image.uploadStartedAt <= IMAGE_UPLOAD_STALE_MS,
  );
  useEffect(() => {
    // A fresh clock when the answer flips, so a placeholder that started a moment ago is
    // not measured against a `now` from half a minute ago.
    setNow(Date.now());
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), IMAGE_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}
