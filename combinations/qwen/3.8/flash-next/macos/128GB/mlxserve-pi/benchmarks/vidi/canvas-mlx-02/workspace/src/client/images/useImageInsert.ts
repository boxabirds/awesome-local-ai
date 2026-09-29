// The image add flow (story 12, design `image.insert`): the one place that turns
// dropped, pasted or picked files into board objects. It is a hook rather than a
// module of functions because it owns live, per-tab state that is deliberately NOT
// in the Y.Doc: upload progress (only the uploader's own screen sees it), which
// images can be retried (the File is kept in memory and is lost on reload), the
// toast queue, and whether a file-drag is currently over the board.
//
// The pipeline for every entry point is the same three moves:
//   1. gate on the connection - offline, nothing is added (images.offline);
//   2. validate and decode - a bad type, an oversized or a too-many batch, or a
//      file that will not decode is refused with the product's exact words;
//   3. create every placeholder in ONE undo step, then upload them in parallel,
//      writing ready/failed back under UPLOAD_ORIGIN (never its own undo step).
//
// The three ways in differ only in WHERE the images land: a drop lands top-left at
// the cursor, a paste and a toolbar pick centre on the view.
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera.ts';
import { screenToWorld } from '../canvas/camera.ts';
import type { Size, Point } from '../../shared/geometry.ts';
import type { ConnectionState } from '../collab/connectBoard.ts';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image.ts';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles.ts';
import { uploadImage } from './uploadImage.ts';
import type { UploadResult } from './uploadImage.ts';
import type { FileRejection } from './validateFiles.ts';

export interface ImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** the live camera, to turn a drop point / the view centre into world units */
  camera: Camera;
  /** the connection state: an add only runs while connected or confirmed */
  connection: ConnectionState;
  /** this tab's identity, stored as each placeholder's `uploaderId` */
  identityId: string;
  /** the viewport's pixel size, to centre a pick or paste in the visible area */
  viewport: Size;
}

export interface ImageInsertApi {
  /** wire to the drop surface's onDragOver (also reveals the drop highlight) */
  onDragOver(e: React.DragEvent): void;
  /** wire to the drop surface's onDrop */
  onDrop(e: React.DragEvent): void;
  /** wire to the window's paste (ignored while a text field has focus) */
  onPaste(e: BoardPasteEvent): void;
  /** open the OS file picker (the Image button and the I shortcut) */
  openPicker(): void;
  /** the picker's file <input>: BoardApp renders it and reads these */
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPickerChange(e: React.ChangeEvent<HTMLInputElement>): void;
  /** live upload progress per object id, uploader-only (0..1) */
  progress: ReadonlyMap<string, number>;
  /** re-upload a failed image whose File is still in memory; false if it is not */
  retry(id: string): boolean;
  /** whether a failed image can be retried (its File is still held) */
  canRetry(id: string): boolean;
  /** whether a retry is in flight for this id */
  isRetrying(id: string): boolean;
  /** the toast messages to show, oldest first */
  toasts: readonly string[];
  /** drop one toast */
  dismissToast(message: string): void;
  /** true while a file drag is over the board (drives the drop highlight) */
  dropActive: boolean;
}

/** Only these connection states may add an image (images.offline). */
function canInsert(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

/**
 * The narrow shape of a paste event this flow needs. It is deliberately not
 * `ClipboardEvent` so a real window paste, a React synthetic paste and a hand-built
 * test event all satisfy it - the flow reads only `clipboardData.files` and calls
 * `preventDefault`.
 */
export interface BoardPasteEvent {
  clipboardData?: { files?: FileList | File[] | null } | null;
  preventDefault(): void;
}

/** Does this drag/clipboard carry files (rather than a dragged note or text)? */
function hasFiles(types: DOMStringList | readonly string[] | null | undefined): boolean {
  if (!types) return false;
  const list = Array.from(types as ArrayLike<string>);
  return list.includes('Files');
}

/** The pixel point inside `el` that a client-space event landed on. */
function localPoint(e: { clientX: number; clientY: number }, el: Element | null): Point {
  const rect = el?.getBoundingClientRect();
  return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
}

/** The dimensions a decoded image reports, from the platform's own decoder. */
function decodeSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
  return createImageBitmap(file)
    .then((bmp) => {
      const width = bmp.width;
      const height = bmp.height;
      // A bitmap with no size is not an image we can place.
      const ok = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
      // Free the decoder's memory as soon as we have the two numbers.
      bmp.close?.();
      return ok ? { width, height } : null;
    })
    .catch(() => null);
}

export function useImageInsert(args: ImageInsertArgs): ImageInsertApi {
  const { doc, boardId, identityId } = args;

  // Read the fast-changing inputs through refs so the event handlers keep a stable
  // identity (they are attached once to the drop surface) yet never act on a stale
  // camera or connection.
  const cameraRef = useRef(args.camera);
  cameraRef.current = args.camera;
  const connectionRef = useRef(args.connection);
  connectionRef.current = args.connection;
  const viewportRef = useRef(args.viewport);
  viewportRef.current = args.viewport;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [toasts, setToasts] = useState<readonly string[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The in-memory File behind each id, kept ONLY so a failure can be retried
  // without re-asking for the file. It is not serialised and does not survive a
  // reload - which is exactly why a reloaded tab offers only Remove (images.retry).
  const fileById = useRef<Map<string, File>>(new Map());
  // Whether a retry upload is currently running for an id, so a double-click on
  // Retry never fires two uploads at once.
  const retrying = useRef<Set<string>>(new Set());
  // The drop-highlight timeout, so a drag that simply leaves (no further dragover)
  // clears the frame without needing a separate dragleave listener.
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((message: string) => {
    setToasts((prev) => (prev.includes(message) ? prev : [...prev, message]));
  }, []);

  const dismissToast = useCallback((message: string) => {
    setToasts((prev) => prev.filter((m) => m !== message));
  }, []);

  const writeProgress = useCallback((id: string, fraction: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  // Run one upload and write its outcome back. Never throws: every result, including
  // a network failure, becomes a status (images.upload_failure).
  const runUpload = useCallback(
    async (id: string, file: File) => {
      const handle = uploadImage(boardId, file, (fraction) => writeProgress(id, fraction));
      const result: UploadResult = await handle.promise;
      retrying.current.delete(id);
      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
        writeProgress(id, null);
        fileById.current.delete(id); // it is stored; no retry to offer
        return;
      }
      markImageFailed(doc, id);
      writeProgress(id, null);
      if (result.kind === 'rate_limited') say(REJECTION_MESSAGES.rate); // images.rate_limit
    },
    [boardId, doc, say, writeProgress],
  );

  // Validate, decode, place in one step, then upload in parallel. `anchor` and the
  // world point are the only difference between drop and pick/paste.
  const addFiles = useCallback(
    async (files: File[], anchor: 'top-left' | 'centre', point: Point) => {
      // 1. offline: nothing is added, ever (images.offline).
      if (!canInsert(connectionRef.current)) {
        say(REJECTION_MESSAGES.offline);
        return;
      }
      // 2. type / size / count, in the product's own words.
      const { accepted, rejections } = validateFiles(files);
      for (const reason of rejections as Set<FileRejection>) say(REJECTION_MESSAGES[reason]);

      // 3. decode the accepted files; one that will not decode is a type refusal.
      const decoded = await Promise.all(
        accepted.map(async (file) => ({ file, size: await decodeSize(file) })),
      );
      const items: { file: File; width: number; height: number }[] = [];
      for (const d of decoded) {
        if (!d.size) say(REJECTION_MESSAGES.type);
        else items.push({ file: d.file, width: d.size.width, height: d.size.height });
      }
      if (items.length === 0) return;

      // 4. the placeholders: every one in a single LOCAL_ORIGIN transaction, which
      //    is what makes the whole add ONE undo step (images.undo).
      const sizes = items.map((it) => placementSize(it.width, it.height));
      const rects = layoutRow(sizes, point, anchor);
      const now = Date.now();
      const ids = createImagePlaceholders(
        doc,
        items.map((it, i) => ({
          rect: rects[i],
          naturalWidth: it.width,
          naturalHeight: it.height,
          contentType: it.file.type,
        })),
        identityId,
        now,
      );

      // 5. remember each File for a possible retry, then start the uploads together.
      ids.forEach((id, i) => {
        fileById.current.set(id, items[i].file);
        writeProgress(id, 0);
      });
      void Promise.all(ids.map((id, i) => runUpload(id, items[i].file)));
    },
    [doc, identityId, runUpload, say, writeProgress],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (dropTimer.current) clearTimeout(dropTimer.current);
      setDropActive(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      const world = screenToWorld(cameraRef.current, localPoint(e, e.currentTarget as Element));
      void addFiles(Array.from(files), 'top-left', world);
    },
    [addFiles],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      // Only a file drag reveals the highlight, and only a file drag is accepted.
      if (!hasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      setDropActive(true);
      if (dropTimer.current) clearTimeout(dropTimer.current);
      // dragover fires about every third of a second while over the board; a
      // silence means the pointer left, so the frame quietly goes away.
      dropTimer.current = setTimeout(() => setDropActive(false), 1000);
    },
    [],
  );

  const onPaste = useCallback(
    (e: BoardPasteEvent) => {
      // A paste while a text field or note editor has focus is typing, not adding:
      // leave it entirely to the browser (images.paste).
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          (el as HTMLElement).isContentEditable === true)
      ) {
        return;
      }
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return; // no image files: ignored
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return; // text or files that are not images: ignored
      e.preventDefault();
      const cam = cameraRef.current;
      const vp = viewportRef.current;
      const centre = screenToWorld(cam, { x: vp.width / 2, y: vp.height / 2 });
      void addFiles(images, 'centre', centre);
    },
    [addFiles],
  );

  const onPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      const chosen = files ? Array.from(files) : [];
      e.target.value = ''; // let the same file be picked again next time
      if (chosen.length === 0) return;
      const cam = cameraRef.current;
      const vp = viewportRef.current;
      const centre = screenToWorld(cam, { x: vp.width / 2, y: vp.height / 2 });
      void addFiles(chosen, 'centre', centre);
    },
    [addFiles],
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const canRetry = useCallback((id: string) => fileById.current.has(id), []);

  const isRetrying = useCallback((id: string) => retrying.current.has(id), []);

  const retry = useCallback(
    (id: string): boolean => {
      const file = fileById.current.get(id);
      if (!file) return false; // the File was lost (a reload): only Remove is offered
      if (retrying.current.has(id)) return true; // already re-uploading
      retrying.current.add(id);
      markImageRetrying(doc, id, Date.now());
      writeProgress(id, 0);
      void runUpload(id, file);
      return true;
    },
    [doc, runUpload, writeProgress],
  );

  // Clear the highlight timer on unmount so it never fires into a dead component.
  useEffect(
    () => () => {
      if (dropTimer.current) clearTimeout(dropTimer.current);
    },
    [],
  );

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    inputRef,
    onPickerChange,
    progress,
    retry,
    canRetry,
    isRetrying,
    toasts,
    dismissToast,
    dropActive,
  };
}
