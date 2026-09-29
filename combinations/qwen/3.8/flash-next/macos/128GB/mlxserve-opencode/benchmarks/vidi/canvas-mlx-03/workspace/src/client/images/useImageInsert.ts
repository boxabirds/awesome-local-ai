// Getting pictures onto the board, by every way a person has of bringing them
// (story 12: image.drop, image.paste, image.pick).
//
// Three entrances, one path. A drop, a paste and a file picker differ only in where the files
// come from and where the row of pictures is put: from there they are the same sequence — ask
// whether this board can take anything, sort the files, say something about the ones that are
// not coming, make the boxes, and send the bytes. Keeping one path rather than three matters
// because the story's promises are all about the middle of it: the same messages, the same
// placeholders, the same states, whoever used which entrance.
//
// The order is the story's and not a preference:
//
//   1. the connection, because an upload cannot start on a board this tab cannot reach, and a
//      placeholder created now would be an abandoned upload five minutes from now;
//   2. the count, which is known before any file is opened;
//   3. the files, by their bytes rather than their names;
//   4. the placeholders, in one transaction — one undo step, one set of boxes arriving on every
//      screen at the same moment;
//   5. the uploads, all at once, each one's progress going to the box it belongs to.
//
// Nothing here throws. Every failure ends as a state on an object and, where the story says so,
// a sentence in the toast area — because a file that could not be added is a thing a person can
// act on, and an exception is not.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  layoutRow,
  type Size,
} from '../../shared/objects/image.ts';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config.ts';
import type { Camera, Point, Size as ScreenSize } from '../canvas/camera.ts';
import { screenToWorld } from '../canvas/camera.ts';
import type { ConnectionState } from '../board/useConnectionBadge.ts';
import { isEditableTarget } from '../board/useBoardKeys.ts';
import {
  dimensionsOf,
  REJECTION_MESSAGES,
  validateFiles,
  type BitmapDecoder,
} from './validateFiles.ts';
import { pushToast } from '../ui/Toast.tsx';
import { uploadImage, type UploadHandle } from './uploadImage.ts';

/** The connection states a file can be uploaded in. Everything else is "not yet". */
export const LIVE_CONNECTIONS: readonly ConnectionState[] = ['connected', 'confirmed'];

/** Does this drag carry files, as opposed to text or a link from another page? */
export function dragCarriesFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/** The files a clipboard event carries, or none. */
export function clipboardFiles(e: { clipboardData?: DataTransfer | null }): File[] {
  const files = e.clipboardData?.files;
  return files ? Array.from(files) : [];
}

/**
 * The type to write down for a file. The browser's guess, and only when it is one of the four
 * the board takes: the field is a label for what is already known about the bytes, and a file
 * that claimed to be a PDF is not a PNG because it was accepted.
 */
export function declaredTypeOf(file: File): string {
  const type = (file.type ?? '').trim().toLowerCase();
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type) ? type : '';
}

export interface ImageInsertArgs {
  doc: Y.Doc;
  /** The board the bytes are sent to; no board, no upload. */
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  /** This tab's identity, written onto the placeholder as the one that can retry it. */
  identityId: string;
  /** The board area in screen pixels, for centring a picked or pasted row. */
  viewport?: ScreenSize;
  /** Test seam: what the image decoder answers about a file. */
  decode?: BitmapDecoder;
}

export interface ImageInsert {
  onDragEnter(e: DragEvent): void;
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  /** Opens the file picker. The one thing the Image button and `I` do. */
  openPicker(): void;
  /** Whether a file is currently being dragged over the board. */
  dropHighlight: boolean;
  /** Object id → 0…1, for the uploads *this* tab is running. */
  progress: ReadonlyMap<string, number>;
  /** Send the same file again. False when there is no file to send. */
  retry(id: string): boolean;
  /** Whether `retry(id)` would have anything to send. */
  canRetry(id: string): boolean;
}

/**
 * The drop, paste and picker flows, and the uploads they start.
 *
 * The files a Retry needs are held in memory and nowhere else — not in the document, not on the
 * server — which is exactly what makes Retry this tab's button and "Image unavailable" everyone
 * else's sentence (image.upload_failure).
 */
export function useImageInsert(args: ImageInsertArgs): ImageInsert {
  const { doc, boardId, identityId } = args;

  // Everything the window-level handlers and the upload callbacks act on is read through a ref,
  // so a handler registered once can never act on a stale camera, connection or document.
  const cameraRef = useRef(args.camera);
  cameraRef.current = args.camera;
  const connectionRef = useRef(args.connection);
  connectionRef.current = args.connection;
  const viewportRef = useRef(args.viewport);
  viewportRef.current = args.viewport;
  const decodeRef = useRef(args.decode);
  decodeRef.current = args.decode;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [dropHighlight, setDropHighlight] = useState(false);

  /** Object id → the file that is on its way, or that failed on the way. */
  const files = useRef(new Map<string, File>());
  const uploads = useRef(new Map<string, UploadHandle>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const handle of uploads.current.values()) handle.abort();
      uploads.current.clear();
    };
  }, []);

  const isLive = useCallback(
    () => LIVE_CONNECTIONS.includes(connectionRef.current),
    [],
  );

  const writeProgress = useCallback((id: string, fraction: number | undefined) => {
    setProgress((current) => {
      const had = current.has(id);
      if (fraction === undefined) {
        if (!had) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      }
      if (had && current.get(id) === fraction) return current;
      const next = new Map(current);
      next.set(id, fraction);
      return next;
    });
  }, []);

  /** Send one file's bytes, and write down whatever comes of it. */
  const startUpload = useCallback(
    (id: string, file: File) => {
      const handle = uploadImage(boardId, file, (fraction) => {
        if (alive.current) writeProgress(id, fraction);
      });
      uploads.current.set(id, handle);
      void handle.promise.then((result) => {
        uploads.current.delete(id);
        if (!alive.current) return;
        writeProgress(id, undefined);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
          return;
        }
        markImageFailed(doc, id);
        // The box on the board says "Upload failed" already. A toast for the same fact would be
        // two voices saying one thing. A refusal to take any more is different: it is about the
        // next minute, not about this file, and it has to be heard apart from the box.
        if (result.kind === 'rate_limited') pushToast(REJECTION_MESSAGES.rate);
      });
    },
    [boardId, doc, writeProgress],
  );

  /**
   * The whole path, from a list of files to placeholders and uploads.
   *
   * `at` is where the row begins: the point a file was dropped on, with the row starting there;
   * or the middle of the visible board, with the row centred on it — which is what a picked or
   * pasted picture owes a person who was not pointing at anything.
   */
  const addFiles = useCallback(
    async (list: readonly File[], at: { point: Point; anchor: 'top-left' | 'centre' }) => {
      if (!isLive()) {
        pushToast(REJECTION_MESSAGES.offline);
        return;
      }
      if (list.length === 0) return;

      const { accepted, rejected } = await validateFiles(list);
      // One message per *reason*, not per file: thirty rejected files are one thing wrong, and
      // thirty toasts would hide the board the person is trying to fix.
      const reasons = new Set(rejected.map((rejection) => rejection.reason));
      for (const reason of reasons) pushToast(REJECTION_MESSAGES[reason]);
      if (accepted.length === 0) return;

      // The boxes are laid out at the size the pictures will have when they arrive, so nothing
      // on the board moves when an upload finishes (image.placement_size).
      const measured = await Promise.all(
        accepted.map(async (file) => ({
          file,
          natural: await dimensionsOf(file, decodeRef.current ?? undefined),
        })),
      );
      const kept = measured
        .map((entry) => ({
          file: entry.file,
          natural: entry.natural,
          size: placementSize(entry.natural.width, entry.natural.height),
        }))
        .filter((entry): entry is { file: File; natural: Size; size: Size } => entry.size !== null);
      if (kept.length === 0) return;

      const rects = layoutRow(
        kept.map((entry) => entry.size),
        at.point,
        at.anchor,
      );
      const ids = createImagePlaceholders(
        doc,
        kept.map((entry, index) => ({
          rect: rects[index]!,
          naturalWidth: entry.natural.width,
          naturalHeight: entry.natural.height,
          contentType: declaredTypeOf(entry.file),
        })),
        identityId,
        Date.now(),
      );

      ids.forEach((id, index) => {
        const file = kept[index]!.file;
        files.current.set(id, file);
        startUpload(id, file);
      });
    },
    [doc, identityId, isLive, startUpload],
  );

  /** The middle of the visible board, in board units. */
  const viewCentre = useCallback((): Point => {
    const size = viewportRef.current;
    const width = size?.width ?? (typeof window === 'undefined' ? 0 : window.innerWidth);
    const height = size?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight);
    return screenToWorld(cameraRef.current, { x: width / 2, y: height / 2 });
  }, []);

  const onDragEnter = useCallback(
    (e: DragEvent) => {
      if (!dragCarriesFiles(e)) return;
      e.preventDefault();
      setDropHighlight(true);
    },
    [],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    // A drag the page does not accept is one the browser would navigate to, so the only way to
    // be allowed to drop a file is to say so on every over-event, and to say what will happen.
    if (!dragCarriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDropHighlight(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!dragCarriesFiles(e)) return;
    // Leaving the window ends the drag; moving over a child of the board does not, and a frame
    // that blinked as the pointer crossed a toolbar would be a frame arguing with itself.
    if (e.relatedTarget instanceof Node && e.currentTarget instanceof Node) {
      if (e.currentTarget.contains(e.relatedTarget)) return;
    }
    setDropHighlight(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!dragCarriesFiles(e)) return;
      e.preventDefault();
      setDropHighlight(false);
      const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      void addFiles(dropped, {
        point: screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY }),
        anchor: 'top-left',
      });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const pasted = clipboardFiles(e);
      if (pasted.length === 0) return; // a paste of text is not this story's business
      if (isEditableTarget(e.target)) return; // a caret in a field is where the paste belongs
      e.preventDefault();
      void addFiles(pasted, { point: viewCentre(), anchor: 'centre' });
    },
    [addFiles, viewCentre],
  );

  /**
   * The file picker.
   *
   * It is a real `<input type=file>` mounted once and kept off-screen, and pressing the Image
   * button clicks it. A board that opened the picker itself would have no way to be told what
   * was chosen, and a picker that was built afresh per press could not be opened by the browser
   * at all — only a click on a live element counts as the person asking for a file.
   */
  const pickerRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.tabIndex = -1;
    input.setAttribute('data-testid', 'image-picker');
    input.setAttribute('aria-label', 'Add images');
    // Out of sight, never out of the tab order in a way that traps a keyboard: it is reached by
    // the Image button, and a control nobody can see should not be a stop on the way through.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    const onKeyDown = (event: KeyboardEvent) => event.stopPropagation();
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('change', () => {
      const chosen = input.files ? Array.from(input.files) : [];
      // Cleared before anything else: choosing the same file twice in a row is two actions, and
      // an input that still holds the first would report no change for the second.
      input.value = '';
      if (chosen.length === 0) return;
      void addFiles(chosen, { point: viewCentre(), anchor: 'centre' });
    });
    document.body.appendChild(input);
    pickerRef.current = input;
    return () => {
      input.removeEventListener('keydown', onKeyDown);
      input.remove();
      if (pickerRef.current === input) pickerRef.current = null;
    };
  }, [addFiles, viewCentre]);

  const openPicker = useCallback(() => {
    // The gate is here rather than at the button, because the keyboard shortcut, the button and
    // anything built after them are all ways of asking for the same thing, and a board that is
    // not connected says so in one sentence rather than by doing nothing quietly.
    if (!isLive()) {
      pushToast(REJECTION_MESSAGES.offline);
      return;
    }
    pickerRef.current?.click();
  }, [isLive]);

  const retry = useCallback(
    (id: string) => {
      const file = files.current.get(id);
      if (!file) return false;
      if (!isLive()) {
        pushToast(REJECTION_MESSAGES.offline);
        return false;
      }
      // Back to uploading, with the clock restarted and this tab written down as the one doing
      // it: the tab that holds the file is the tab that can say what happened next.
      if (!markImageRetrying(doc, id, identityId, Date.now())) return false;
      writeProgress(id, 0);
      startUpload(id, file);
      return true;
    },
    [doc, identityId, isLive, startUpload, writeProgress],
  );

  const canRetry = useCallback((id: string) => files.current.has(id), []);

  // A camera that moved must not re-create every callback a component was handed.
  return useMemo(
    () => ({
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
      openPicker,
      dropHighlight,
      progress,
      retry,
      canRetry,
    }),
    [
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
      openPicker,
      dropHighlight,
      progress,
      retry,
      canRetry,
    ],
  );
}
