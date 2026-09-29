/**
 * The three ways to add images: drop, paste, file picker (story 12, image.insert).
 *
 * One path for all three: gate on the connection, validate the files, measure
 * them, create placeholders in one transaction (one undo step), then upload each
 * file in parallel and write the outcome back into the doc.
 *
 * Progress is *not* stored in this hook's state: `ImageObject` subscribes to the
 * upload queue directly, so a progress tick re-renders the placeholder instead of
 * the whole board. `progress` here is a snapshot for callers that want it.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ClipboardEvent } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import {
  createImagePlaceholders,
  layoutRow,
  placementSize,
  type ImagePlaceholderItem,
  type Size,
} from '../../shared/objects/image';
import type { Point } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { SESSION_IDENTITY } from '../sync/sessionIdentity';
import { showToast } from '../ui/Toast';
import {
  canRetryImage,
  progressOf,
  progressSnapshot,
  retryUpload,
  startUpload,
} from './uploadQueue';
import {
  REJECTION_MESSAGES,
  filesFromDataTransfer,
  validateFiles,
} from './validateFiles';

export interface ImageInsertApi {
  onDragEnter(e: DragEvent | Event): void;
  onDragOver(e: DragEvent | Event): void;
  onDragLeave(e: DragEvent | Event): void;
  onDrop(e: DragEvent | Event): void;
  onPaste(e: ClipboardEvent | Event): void;
  openPicker(): void;
  /** True while files are being dragged over the board (dashed outline). */
  highlight: boolean;
  /** Upload fraction of this session's in-flight images, by object id. */
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

export interface ImageInsertArgs {
  doc: Y.Doc;
  boardId?: string;
  connection: ConnectionState;
  identityId?: string;
  /** Screen point relative to the board area → world point. */
  toWorld(point: Point): Point;
  /** Centre of the visible board area, in world coordinates. */
  viewportCentreWorld(): Point;
  /** Board element rect, for converting drop coordinates. */
  getBoardRect?(): DOMRect | null;
  /** Closes the current undo capture window so an add is one undo step. */
  boundary?(): void;
}

const ONLINE: ReadonlySet<string> = new Set(['connected', 'confirmed']);

/** Uploading needs a live board: while reconnecting nothing is added. */
export function isBoardOnline(state: ConnectionState): boolean {
  return ONLINE.has(state);
}

function isInEditor(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  // `isContentEditable` is not implemented everywhere (jsdom), so the attribute
  // is checked as well: either way, a focused editor owns the paste.
  if (el.isContentEditable === true) return true;
  const editable = el.getAttribute?.('contenteditable');
  return editable === 'true' || editable === '';
}

function hasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return Array.from(transfer.types ?? []).includes('Files');
}

function isPlacable(...values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value > 0);
}

/**
 * Natural pixel dimensions of a file, or null when it cannot be decoded.
 * Decoding is the client-side half of "judged by its content": a PDF renamed to
 * `.png` passes the MIME check and fails here.
 */
export async function measureImage(file: File): Promise<Size | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    if (typeof bitmap.close === 'function') bitmap.close();
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
    if (size.width <= 0 || size.height <= 0) return null;
    return size;
  } catch {
    return null;
  }
}

/**
 * Board-side image insertion. Drop places at the cursor, paste and picker centre
 * in the visible area (PRD image.drop / image.paste / image.pick).
 */
export function useImageInsert(args: ImageInsertArgs): ImageInsertApi {
  const [highlight, setHighlight] = useState(false);
  const dragDepth = useRef(0);

  // Everything the async callbacks need, read through refs so the window
  // listeners are installed once and never see stale values.
  const latest = useRef(args);
  latest.current = args;

  const addFiles = useCallback(
    async (files: readonly File[], anchor: Point | 'centre'): Promise<void> => {
      if (files.length === 0) return;
      const current = latest.current;

      if (!current.boardId || !isBoardOnline(current.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);
      for (const reason of rejections) showToast(REJECTION_MESSAGES[reason]);
      if (accepted.length === 0) return;

      const measured = await Promise.all(
        accepted.map(async (file) => {
          const size = await measureImage(file);
          return size ? { file, size } : null;
        }),
      );
      const usable = measured.filter((entry): entry is { file: File; size: Size } => entry !== null);
      if (usable.length !== accepted.length) showToast(REJECTION_MESSAGES.type);
      if (usable.length === 0) return;

      const sizes = usable.map((entry) => placementSize(entry.size.width, entry.size.height));
      const origin = anchor === 'centre' ? current.viewportCentreWorld() : anchor;
      const rects = layoutRow(sizes, origin, anchor === 'centre' ? 'centre' : 'top-left');

      // Keep the file next to the item it belongs to: the model skips anything it
      // cannot place, so both lists are filtered to the same valid entries first.
      const items: ImagePlaceholderItem[] = [];
      const filesToUpload: File[] = [];
      rects.forEach((rect, i) => {
        const entry = usable[i];
        if (!entry) return;
        if (!isPlacable(rect.width, rect.height) || !isPlacable(entry.size.width, entry.size.height)) return;
        items.push({
          rect,
          naturalWidth: entry.size.width,
          naturalHeight: entry.size.height,
          contentType: entry.file.type,
        });
        filesToUpload.push(entry.file);
      });
      if (items.length === 0) return;

      current.boundary?.();
      const created = createImagePlaceholders(
        current.doc,
        items,
        current.identityId ?? SESSION_IDENTITY,
        Date.now(),
      );
      current.boundary?.();

      // Start every upload in parallel; each writes its own outcome into the doc.
      const count = Math.min(created.length, filesToUpload.length);
      for (let i = 0; i < count; i++) {
        startUpload({
          doc: current.doc,
          boardId: current.boardId as string,
          id: created[i],
          file: filesToUpload[i],
        });
      }
    },
    [],
  );

  const pointFromDrop = useCallback((e: DragEvent | Event): Point => {
    const event = e as DragEvent;
    const rect = latest.current.getBoardRect?.() ?? null;
    const clientX = typeof event.clientX === 'number' ? event.clientX : 0;
    const clientY = typeof event.clientY === 'number' ? event.clientY : 0;
    const local = rect
      ? { x: clientX - rect.left, y: clientY - rect.top }
      : { x: clientX, y: clientY };
    return latest.current.toWorld(local);
  }, []);

  const clearHighlight = useCallback(() => {
    dragDepth.current = 0;
    setHighlight(false);
  }, []);

  const onDragEnter = useCallback((e: DragEvent | Event) => {
    if (!hasFiles((e as DragEvent).dataTransfer ?? null)) return;
    dragDepth.current += 1;
    setHighlight(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent | Event) => {
    const event = e as DragEvent;
    if (!hasFiles(event.dataTransfer ?? null)) return;
    // Accepting the drop is what makes the copy cursor appear.
    event.preventDefault?.();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setHighlight(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent | Event) => {
    if (!hasFiles((e as DragEvent).dataTransfer ?? null)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setHighlight(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent | Event) => {
      const event = e as DragEvent;
      const files = filesFromDataTransfer(event.dataTransfer ?? null);
      if (files.length === 0) return;
      event.preventDefault?.();
      clearHighlight();
      void addFiles(files, pointFromDrop(e));
    },
    [addFiles, clearHighlight, pointFromDrop],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent | Event) => {
      const event = e as ClipboardEvent;
      // While a text editor has focus a paste belongs to the text (PRD image.paste).
      if (isInEditor(event.target ?? null)) return;
      const files = filesFromDataTransfer(event.clipboardData ?? null);
      if (files.length === 0) return;
      event.preventDefault?.();
      void addFiles(files, 'centre');
    },
    [addFiles],
  );

  // Hidden file input, kept in the DOM so the picker is one click (or the `I`
  // key) away and so tests can drive it directly.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.multiple = true;
    input.tabIndex = -1;
    input.dataset.testid = 'image-file-input';
    input.setAttribute('aria-hidden', 'true');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      input.value = '';
      if (files.length > 0) void addFiles(files, 'centre');
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return () => {
      input.remove();
      inputRef.current = null;
    };
  }, [addFiles]);

  const openPicker = useCallback(() => {
    // Only the connection is checked here: choosing a file is harmless, and the
    // gate in `addFiles` still refuses to add anything without a live board.
    if (!isBoardOnline(latest.current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    inputRef.current?.click();
  }, []);

  // Global listeners: files can be dropped anywhere over the board page, and a
  // paste has no target element of its own.
  useEffect(() => {
    const target = window;
    target.addEventListener('dragenter', onDragEnter);
    target.addEventListener('dragover', onDragOver);
    target.addEventListener('dragleave', onDragLeave);
    target.addEventListener('drop', onDrop);
    target.addEventListener('paste', onPaste as EventListener);
    return () => {
      target.removeEventListener('dragenter', onDragEnter);
      target.removeEventListener('dragover', onDragOver);
      target.removeEventListener('dragleave', onDragLeave);
      target.removeEventListener('drop', onDrop);
      target.removeEventListener('paste', onPaste as EventListener);
    };
  }, [onDragEnter, onDragOver, onDragLeave, onDrop, onPaste]);

  // Objects that disappear mid-flight are forgotten by the queue itself (its
  // bookkeeping is keyed by object id and cleaned up on Remove / unmount).

  const retry = useCallback((id: string) => {
    const current = latest.current;
    if (!current.boardId) return false;
    if (!isBoardOnline(current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return false;
    }
    return retryUpload(current.doc, current.boardId, id);
  }, []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    highlight,
    progress: progressSnapshot(),
    retry,
    canRetry: canRetryImage,
  };
}

/** Progress for one object id, exported for the object component. */
export { progressOf };
