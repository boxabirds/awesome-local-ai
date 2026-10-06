/**
 * Adding images to a board: drop, paste, picker, upload, retry (story 12).
 *
 * One hook owns the whole client side of "I want this picture on the board", which is four paths in
 * and three things out:
 *
 *   in : a file drag released over the board, a paste with an image in it, files chosen by the
 *        system picker, and Retry on an image whose upload did not work;
 *   out: placeholder objects in the document, XHR uploads that fill them in, and messages that
 *        explain what was refused.
 *
 * The order of operations is the story's promise: **nothing is written until the connection can
 * carry it and the bytes are worth having**. An offline board says so and adds nothing - no
 * placeholder that would outlive the attempt, no half-finished object for someone else to find. A
 * file that is not one of the four formats, or bigger than ten megabytes, is refused before a byte
 * of it is sent, and the reason is said in the PRD's words.
 *
 * Only then is the placeholder created - in one transaction for the whole batch, at its final size
 * and position - and the uploads started in parallel behind it. The progress map is this screen's
 * private knowledge: it is what the uploader's placeholder draws, and nobody else can have it
 * because nobody else is carrying those bytes. The `File` objects are kept in memory for the same
 * reason Retry is only possible here: after a reload the bytes are gone, so a failed image left
 * behind offers Remove and nothing else.
 */
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point, Rect, Size } from '../../shared/geometry';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import type { ToastMessage } from '../ui/Toast';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';

/** What an image object needs from this hook: how far along it is, and what can be done about it. */
export interface ImageInsertActions {
  /** Whose screen this is, compared against an image's `uploaderId`. */
  readonly identityId: string;
  /** Upload progress by object id, for the images this screen is sending. */
  readonly progress: ReadonlyMap<string, number>;
  /** Whether the bytes of this image are still here to send again. */
  canRetry(id: string): boolean;
  /** Sends `id`'s file again. False when there is nothing to send. */
  retry(id: string): boolean;
  /** Takes the object off the board (story 7's delete). */
  remove(id: string): void;
}

/** Handed to every object on the board, so an image can ask about its own upload. */
export const ImageInsertContext = createContext<ImageInsertActions | null>(null);

export interface ImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  /** So a drop point in screen pixels becomes the world coordinate it happened at. */
  camera: Camera;
  /** Story 3's connection state: an add needs a connection that can carry it. */
  connection: ConnectionState;
  /** This screen's identity, stored on the image so only this screen gets Retry. */
  identityId: string;
  /** The visible board area, for centring a paste or a picked file. Defaults to the window. */
  viewport?: Size;
  /** Story 8: an add is a step of its own, so close whatever step came just before it. */
  boundary?(): void;
  /** The picker went away: the tool that was up goes back to Select. */
  toolDown?(): void;
}

export interface ImageInsertController {
  /** Whose screen this is, compared against an image's `uploaderId`. */
  readonly identityId: string;
  /** Upload progress by object id, for the images this screen is sending. */
  readonly progress: ReadonlyMap<string, number>;
  /** Whether the bytes of this image are still here to send again. */
  canRetry(id: string): boolean;
  /** Sends `id`'s file again. False when there is nothing to send. */
  retry(id: string): boolean;
  /** A file is being dragged over the board: show the drop highlight. */
  readonly dragOver: boolean;
  /** What went wrong, in the words the PRD fixes. */
  readonly toasts: readonly ToastMessage[];
  /** Called when the messages have been on screen long enough. */
  dismissToasts(): void;
  onDragEnter(e: DragEvent): void;
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  /** Opens the system file picker. Does nothing - and says why - while offline. */
  openPicker(): void;
  /** Stops watching an image: its kept file, its transfer and its progress. */
  forget(id: string): void;
}

/**
 * Anything that holds files: a `FileList`, an array, or a test's stand-in for one.
 *
 * Written as a shape rather than as `FileList` because the three places files arrive from - a drag, the
 * clipboard, a file input - hand over slightly different objects, and because a jsdom test has no way to
 * build a real `FileList`. What every one of them has is a length and a way to get one entry.
 */
interface FileBag {
  readonly length: number;
  readonly [index: number]: File | undefined;
  item?(index: number): File | null | undefined;
}

function isFileBag(value: unknown): value is FileBag {
  return typeof value === 'object' && value !== null && typeof (value as { length?: unknown }).length === 'number';
}

/** The files behind a drag, a file input or a clipboard, as an array. */
function fileListOf(source: DataTransfer | FileBag | null | undefined): File[] {
  if (!source) return [];
  const bag: FileBag | null = isFileBag(source) ? source : ((source as DataTransfer).files ?? null);
  if (!bag) return [];
  const files: File[] = [];
  for (let index = 0; index < bag.length; index += 1) {
    const file = typeof bag.item === 'function' ? bag.item(index) : bag[index];
    if (file) files.push(file);
  }
  return files;
}

/** Files in a paste: the clipboard offers them as `files`, and older WebKit only as `items`. */
function clipboardFiles(data: DataTransfer | null | undefined): File[] {
  const files = fileListOf(data);
  if (files.length > 0) return files;
  const items = data?.items;
  if (!items) return [];
  const pulled: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item && item.kind === 'file') {
      const file = item.getAsFile();
      if (file) pulled.push(file);
    }
  }
  return pulled;
}

/** True when this drag is carrying files rather than a selection or some text. */
function carriesFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (types) return Array.prototype.includes.call(types, 'Files');
  return fileListOf(e.dataTransfer).length > 0;
}

/** True when the keyboard or a drop belongs to a field the person is writing in. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** True when a change made here can reach the other people on the board. */
function canSend(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

/** The file's own pixels, or null when the browser cannot make a picture out of it. */
async function decodeSize(file: File): Promise<Size | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    // The bitmap was only ever a measuring tool: the board keeps the numbers, not the pixels.
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Adds images to the board and keeps their uploads alive.
 *
 * Everything that could fail - a file that will not decode, a connection that dropped mid-transfer,
 * a placeholder someone deleted while its bytes were still going - ends in a message or in the
 * object's own state. None of it is thrown, because the person is standing in a board that they are
 * allowed to carry on using.
 */
export function useImageInsert(options: ImageInsertOptions): ImageInsertController {
  const { doc, boardId, camera, connection, identityId } = options;

  // The handlers below live as long as the board does, so they read the current values through a
  // ref instead of being rebuilt on every render (and re-attached to the window with them).
  const live = useRef({ doc, boardId, connection, identityId, camera, viewport: options.viewport, boundary: options.boundary, toolDown: options.toolDown });
  live.current = {
    doc,
    boardId,
    connection,
    identityId,
    camera,
    viewport: options.viewport,
    boundary: options.boundary,
    toolDown: options.toolDown,
  };

  /** The bytes behind each image this screen added, for Retry. Gone on reload, by design. */
  const kept = useRef(new Map<string, File>());
  const inFlight = useRef(new Map<string, UploadHandle>());
  /** A picker left open, so opening another does not leave the old input behind. */
  const picker = useRef<HTMLInputElement | null>(null);
  /** How many drag events deep into the page we are; 0 means the pointer is off the board. */
  const dragDepth = useRef(0);

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dragOver, setDragOver] = useState(false);
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const toastSequence = useRef(0);

  const say = useCallback((texts: Iterable<string>): void => {
    const fresh: ToastMessage[] = [];
    for (const text of texts) fresh.push({ id: (toastSequence.current += 1), text });
    if (fresh.length === 0) return;
    setToasts((current) => [...current, ...fresh]);
  }, []);

  const dismissToasts = useCallback((): void => {
    setToasts([]);
  }, []);

  const writeProgress = useCallback((id: string, fraction: number | null): void => {
    setProgress((current) => {
      const next = new Map(current);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  /** Starts (or restarts) the transfer of one image's bytes. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const previous = inFlight.current.get(id);
      if (previous) previous.abort();
      kept.current.set(id, file);

      const handle = uploadImage(live.current.boardId, file, (fraction) => {
        writeProgress(id, fraction);
      });
      inFlight.current.set(id, handle);

      void handle.promise.then((result) => {
        if (inFlight.current.get(id) === handle) inFlight.current.delete(id);
        // A placeholder that has been deleted, undone or removed in the meantime is not written
        // back into existence; the `mark…` functions answer false and change nothing.
        if (result.kind === 'ok') markImageReady(live.current.doc, id, result.assetKey);
        else markImageFailed(live.current.doc, id);
        writeProgress(id, null);
      });
    },
    [writeProgress],
  );

  /**
   * The one path every add goes through: check the connection, check the files, measure them, write
   * the placeholders, start the transfers.
   */
  const addFiles = useCallback(
    async (incoming: readonly File[], point: Point, anchor: 'top-left' | 'centre'): Promise<void> => {
      if (incoming.length === 0) return;
      const state = live.current;

      // An add needs a connection that can carry it. Nothing is written, and nothing is queued for
      // later either: the person is told, and can drop the same file again once the board is back.
      if (!canSend(state.connection)) {
        say([REJECTION_MESSAGES.offline]);
        return;
      }

      const { accepted, rejections } = validateFiles(incoming);
      for (const reason of rejections) say([REJECTION_MESSAGES[reason]]);
      if (accepted.length === 0) return;

      // The placeholder is created at the image's real proportions, so the size comes from the file
      // itself. A file that will not decode is left out here, with the type message.
      const measured: { file: File; size: Size }[] = [];
      let undecodable = false;
      for (const file of accepted) {
        const size = await decodeSize(file);
        if (size === null) {
          undecodable = true;
          continue;
        }
        measured.push({ file, size });
      }
      if (undecodable) say([REJECTION_MESSAGES.type]);
      if (measured.length === 0) return;

      const sizes: Size[] = [];
      const usable: { file: File; size: Size }[] = [];
      for (const item of measured) {
        const placed = placementSize(item.size.width, item.size.height);
        if (!placed) continue;
        sizes.push(placed);
        usable.push(item);
      }
      if (usable.length === 0) return;

      const rects: Rect[] = layoutRow(sizes, point, anchor);
      const items = rects.map((rect, index) => ({
        rect,
        naturalWidth: usable[index]!.size.width,
        naturalHeight: usable[index]!.size.height,
        contentType: usable[index]!.file.type,
      }));

      // One transaction, one undo step: stepping back over an add takes the whole row away.
      state.boundary?.();
      const ids = createImagePlaceholders(state.doc, items, state.identityId, Date.now());
      state.boundary?.();

      ids.forEach((id, index) => startUpload(id, usable[index]!.file));
    },
    [say, startUpload],
  );

  /** The middle of what this screen can see, in world coordinates. */
  const viewCentre = useCallback((): Point => {
    const { camera: cam, viewport } = live.current;
    const size =
      viewport ??
      (typeof window === 'undefined' ? { width: 1, height: 1 } : { width: window.innerWidth, height: window.innerHeight });
    return screenToWorld(cam, { x: size.width / 2, y: size.height / 2 });
  }, []);

  const onDragEnter = useCallback((e: DragEvent): void => {
    if (!carriesFiles(e) || isTextEntry(e.target)) return;
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent): void => {
    if (!carriesFiles(e) || isTextEntry(e.target)) return;
    // Without this the browser refuses the drop and opens the file in the tab instead, which is the
    // most confusing possible answer to dropping a picture on a whiteboard.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (dragDepth.current === 0) dragDepth.current = 1;
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent): void => {
    if (!carriesFiles(e)) return;
    dragDepth.current = dragDepth.current > 0 ? dragDepth.current - 1 : 0;
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent): void => {
      dragDepth.current = 0;
      setDragOver(false);
      const files = fileListOf(e.dataTransfer);
      if (files.length === 0) return; // the board's own drags, and text, are not our business
      // A field the person is writing in keeps the drop. It cannot show an image, and taking the
      // file away from under the cursor would be worse than doing nothing.
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      const where = screenToWorld(live.current.camera, { x: e.clientX, y: e.clientY });
      void addFiles(files, where, 'top-left');
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent): void => {
      // A note, a label or a field being written in owns the paste: a pasted image must not
      // silently appear next to the cursor instead of in the text.
      if (isTextEntry(e.target)) return;
      const files = clipboardFiles(e.clipboardData);
      if (files.length === 0) return; // text is still text, and the board has no use for it
      e.preventDefault();
      void addFiles(files, viewCentre(), 'centre');
    },
    [addFiles, viewCentre],
  );

  /** The input of the last picker. One at a time, and never two on the page. */
  const closePicker = useCallback((): void => {
    if (picker.current === null) return;
    picker.current.remove();
    picker.current = null;
  }, []);

  const openPicker = useCallback((): void => {
    const state = live.current;
    // The offline answer is the same as for a drop, and comes first: a person who cannot save a
    // picture should not be invited to choose one.
    if (!canSend(state.connection)) {
      say([REJECTION_MESSAGES.offline]);
      return;
    }
    closePicker();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    // A hidden input the person will never see, and no test needs to click: `openPicker` is the API.
    input.setAttribute('data-image-file-picker', 'true');
    input.style.position = 'fixed';
    input.style.left = '-100vw';
    input.setAttribute('aria-hidden', 'true');
    input.setAttribute('tabindex', '-1');
    // Reported once, by the browser's dialog or by anything that puts files on the input directly.
    let taken = false;
    input.addEventListener('change', () => {
      const chosen = fileListOf(input.files);
      // A dialog that was closed without choosing anything reports nothing worth taking, and a second
      // report of the same files must not add them twice.
      if (taken || chosen.length === 0) return;
      taken = true;
      // The picker was reached from a button, and the thing it was pressed over goes back to Select
      // once it has done its job.
      live.current.toolDown?.();
      void addFiles(chosen, viewCentre(), 'centre');
    });
    document.body.appendChild(input);
    picker.current = input;
    input.click();
  }, [addFiles, closePicker, say, viewCentre]);

  const retry = useCallback((id: string): boolean => {
    const file = kept.current.get(id);
    if (!file) return false;
    if (!markImageRetrying(live.current.doc, id, Date.now())) return false;
    startUpload(id, file);
    return true;
  }, [startUpload]);

  const canRetry = useCallback((id: string): boolean => kept.current.has(id), []);

  const forget = useCallback((id: string): void => {
    inFlight.current.get(id)?.abort();
    inFlight.current.delete(id);
    kept.current.delete(id);
    writeProgress(id, null);
  }, [writeProgress]);

  // The window is the drop and paste surface: the board covers the window, and a file dragged over
  // anything on this page is being dragged over the board.
  useEffect(() => {
    const pasteListener = (event: Event): void => onPaste(event as ClipboardEvent);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', pasteListener);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', pasteListener);
    };
  }, [onDragEnter, onDragOver, onDragLeave, onDrop, onPaste]);

  // Leaving the board stops the transfers this screen started: nobody's half-sent picture becomes a
  // permanent placeholder. (A placeholder already written stays `uploading` until it goes stale,
  // which is what image.unfinished is for.) The picker's input goes with the board too, so a page does
  // not accumulate one hidden file field per visit.
  useEffect(() => {
    const handles = inFlight.current;
    const keptFiles = kept.current;
    return () => {
      for (const handle of handles.values()) handle.abort();
      handles.clear();
      keptFiles.clear();
      picker.current?.remove();
      picker.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      identityId,
      progress,
      canRetry,
      retry,
      dragOver,
      toasts,
      dismissToasts,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
      openPicker,
      forget,
    }),
    [
      identityId,
      progress,
      canRetry,
      retry,
      dragOver,
      toasts,
      dismissToasts,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
      openPicker,
      forget,
    ],
  );
}
