// Adding images by drop, paste or the file picker (`image.insert`).
//
// This is the orchestration in the middle of the story: three ways in, and all of them
// become the same little pipeline — is the board connected at all, what files survive
// the client's own checks, what does each one really measure once it is decoded, one
// undoable batch of placeholders, then an upload each whose answer moves it to `ready`
// or `failed`. It writes nothing itself and shows nothing itself: it calls the model
// (`image.model`), the uploader (`uploadImage`) and a `Toast` handed down from the
// board, so that every rule it enforces is a rule the model and the server already
// agree on and not a second opinion kept here.
//
// The rules, and where each one comes from:
//
//   - `image.offline` — not connected / confirmed → the offline toast, and nothing
//     added, for drop, paste and picker alike (TC-19). It is checked first, before any
//     file is even looked at, because adding into a board you cannot see is how a
//     board gets lost;
//   - `image.types`, `image.size_limit`, `image.count_limit` — `validateFiles`, then the
//     toasts for whatever it refused (one per reason, not one per file);
//   - `image.types` again, at the decode step — a file that named itself an image but
//     will not decode (`createImageBitmap` rejects) is refused with the type message and
//     gets no placeholder at all (TC-29);
//   - `image.drop` / `image.paste` / `image.pick` — a drop lays the row from its top-left
//     corner at the point, a paste or a pick centres it on the middle of the view;
//   - `image.uploading` — the batch is created in `createImagePlaceholders` (one undo
//     step) and uploaded one by one, reporting XHR progress into a per-image map the
//     uploader alone is shown;
//   - `image.upload_failure` — an upload that failed and whose `File` is still in
//     memory can be retried (`retry`, `canRetry`); that memory does not survive a
//     reload, which is exactly why an abandoned upload becomes `unfinished` instead.
//
// The handlers are attached at the board (window for paste, the viewport for drag and
// drop), so they are read through a `live` ref — a listener installed once must never
// decide about an old render's camera, connection or document. Everything here is
// client code and may touch the DOM (`File`, `DataTransfer`, an `<input type=file>`).
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Adding images".
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ClipboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { Point, Rect, Size } from '../../shared/geometry';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  layoutRow,
  type ImagePlaceholder,
} from '../../shared/objects/image';
import type { ConnectionState } from '../sync/connectBoard';
import type { UndoController } from '../board/undo';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';

export interface ImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** The board's current camera, for turning a drop point or the view centre into world. */
  camera: Camera;
  /** Story 3's connection state; offline stops an add before a file is touched. */
  connection: ConnectionState;
  /** This tab's id, stored as the placeholder's `uploaderId`. */
  identityId: string;
  /** The board's undo history: the add is closed into its own step around the batch. */
  undo: UndoController;
  /** Show a refusal or notice at the bottom of the screen. */
  onToast(message: string): void;
}

export interface ImageInsert {
  /** Files are being dragged over the board (drives the drop highlight). */
  isDragging: boolean;
  onDragEnter(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
  onDragLeave(event: DragEvent): void;
  onDrop(event: DragEvent): void;
  /** A paste whose clipboard carries image files (a paste of text is left alone). */
  onPaste(event: ClipboardEvent): void;
  /** Open the system picker; nothing opens when offline (TC-19). */
  openPicker(): void;
  /** Upload progress (0–1) by object id — the uploader's own placeholder reads it. */
  progress: ReadonlyMap<string, number>;
  /** Re-upload a failed image, if its file is still in memory. False if it is not. */
  retry(id: string): boolean;
  /** Is a retry possible for this id? Only while its file is still held. */
  canRetry(id: string): boolean;
}

/** A paste or a drop is only ours when the transfer carries files. */
function transferHasFiles(types: readonly string[] | undefined): boolean {
  return types !== undefined && types.includes('Files');
}

/** Where a paste belongs to a text control rather than to the board (TC-18). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** A live `FileList` or `File` array from a drop or paste transfer, or none. */
function filesOf(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  if (transfer.files) return Array.from(transfer.files);
  return [];
}

export function useImageInsert(args: ImageInsertArgs): ImageInsert {
  const { onToast } = args;

  // Read through a ref so a listener installed once never acts on an old render's
  // camera, connection or document (`useBoardKeys`'s pattern, for the same reason).
  const live = useRef(args);
  live.current = args;

  // Upload progress and the in-memory files, both per-tab and both gone on reload —
  // which is not a limitation but the mechanism behind `image.unfinished`: after a
  // reload there is no file to retry, so an old `uploading` object can only be removed.
  const heldFiles = useRef(new Map<string, File>());
  const inFlight = useRef(new Map<string, { abort(): void }>());
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());

  const [isDragging, setDragging] = useState(false);
  // Nested dragenter/dragleave (every child element fires them) are counted so the
  // highlight only clears when the pointer has really left the board, not when it
  // passed over an object on its way across it.
  const dragDepth = useRef(0);

  // A picker opened through `openPicker` is one reusable hidden input; a `change`
  // after choosing files runs the same add as a drop, centred in the view.
  const pickerRef = useRef<HTMLInputElement | null>(null);

  const setUploadProgress = useCallback((id: string, fraction: number | null): void => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  /**
   * Upload one already-placed image and record the answer. The status writes are the
   * model's `UPLOAD_ORIGIN` ones, so neither finishing nor failing is an undo step —
   * this is called long after the placeholders' own transaction has closed.
   */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const upload = uploadImage(live.current.boardId, file, (fraction) => {
        setUploadProgress(id, fraction);
      });
      inFlight.current.set(id, upload);
      void upload.promise.then((result) => {
        inFlight.current.delete(id);
        setUploadProgress(id, null);
        if (result.kind === 'ok') markImageReady(live.current.doc, id, result.assetKey);
        else markImageFailed(live.current.doc, id);
      });
    },
    [setUploadProgress],
  );

  /**
   * The one pipeline all three ways in run through: check the connection, validate,
   * decode to measure, place the batch as one undo step, then upload each. Returns
   * nothing and throws nothing — every failure is a toast or a failed placeholder.
   */
  const addFiles = useCallback(
    async (files: File[], origin: Point, anchor: 'top-left' | 'centre'): Promise<void> => {
      const { doc, identityId, connection, undo } = live.current;

      // `image.offline`: nothing is even examined until the board can be written.
      if (connection !== 'connected' && connection !== 'confirmed') {
        onToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);

      // A file that named itself an image but will not decode is a type refusal too,
      // decided here because measuring its size is the first thing that needs it to be
      // a real image (TC-29). Decoded natural sizes are kept to place by.
      const sized: Array<{ file: File; size: Size }> = [];
      for (const file of accepted) {
        const bitmap = await decodeImage(file);
        if (bitmap === null) {
          rejections.add('type');
          continue;
        }
        sized.push({ file, size: { width: bitmap.width, height: bitmap.height } });
        bitmap.close();
      }

      // Say what was refused — one line per reason, in a fixed order, so ten bad files
      // are one notice rather than ten.
      const reasons = (['type', 'size', 'count'] as const).filter((reason) =>
        rejections.has(reason),
      );
      if (reasons.length > 0) onToast(reasons.map((reason) => REJECTION_MESSAGES[reason]).join('\n'));
      if (sized.length === 0) return;

      // Each image's own placement box; one with no finite natural size has no box and
      // is dropped from the row (there is nothing to lay out).
      const placed: Array<{ file: File; size: Size; box: Size }> = [];
      for (const entry of sized) {
        const box = placementSize(entry.size.width, entry.size.height);
        if (box === null) continue;
        placed.push({ file: entry.file, size: entry.size, box });
      }
      if (placed.length === 0) return;

      // The row: a drop runs right from the point, a paste or pick centres the whole
      // row on it. One rect per placed image, in the same order.
      const rects: Rect[] = layoutRow(
        placed.map((entry) => entry.box),
        origin,
        anchor,
      );

      const items: ImagePlaceholder[] = placed.map((entry, index) => ({
        rect: rects[index]!,
        naturalWidth: entry.size.width,
        naturalHeight: entry.size.height,
        contentType: entry.file.type,
      }));

      // One undo step for the whole add: close whatever came before, place the batch,
      // close this step (`image.uploading`, undo.history, TC-05).
      undo.boundary();
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());
      undo.boundary();

      // The files are held so a failed one can be retried, and uploaded one by one.
      ids.forEach((id, index) => {
        const file = placed[index]!.file;
        heldFiles.current.set(id, file);
        startUpload(id, file);
      });
    },
    [onToast, startUpload],
  );

  // --- Drop ----------------------------------------------------------------

  const onDragEnter = useCallback((event: DragEvent): void => {
    if (!transferHasFiles(Array.from(event.dataTransfer?.types ?? []))) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent): void => {
    if (!transferHasFiles(Array.from(event.dataTransfer?.types ?? []))) return;
    // The only thing that lets a drop land, and it is reported as a copy.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((_event: DragEvent): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent): void => {
      const files = filesOf(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      // A drop says *here*: the first image's top-left corner goes at the point.
      const point = screenToWorld(live.current.camera, { x: event.clientX, y: event.clientY });
      void addFiles(files, point, 'top-left');
    },
    [addFiles],
  );

  // --- Paste ---------------------------------------------------------------

  const onPaste = useCallback(
    (event: ClipboardEvent): void => {
      // A paste that lands inside a text editor belongs to that editor: typing an image
      // into a note is not this story, and only the board itself (a paste not in a text
      // control) adds an image (TC-18). The check is on where the paste landed, which is
      // the same test the keyboard handler uses.
      if (isTypingTarget(event.target)) return;
      const files = filesOf(event.clipboardData);
      // No image files on the clipboard is not our paste at all — a paste of text into
      // the board, or anywhere, is left exactly as the browser would do it.
      if (files.length === 0) return;
      // A paste that reaches here is on the board and not in a text editor, so it is
      // ours: take it from the browser so it does not also try to paste the image inline.
      event.preventDefault();
      // A paste has no point, so the row is centred on the middle of what you can see.
      const point = viewCentre(live.current.camera);
      void addFiles(files, point, 'centre');
    },
    [addFiles],
  );

  // --- Picker --------------------------------------------------------------

  const openPicker = useCallback((): void => {
    if (live.current.connection !== 'connected' && live.current.connection !== 'confirmed') {
      onToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = pickerRef.current ?? createPickerInput();
    pickerRef.current = input;
    input.onchange = (): void => {
      const files = Array.from(input.files ?? []);
      // Reset first, so choosing the same file twice in a row still reads as a change.
      input.value = '';
      if (files.length === 0) return;
      void addFiles(files, viewCentre(live.current.camera), 'centre');
    };
    input.click();
  }, [addFiles, onToast]);

  // --- Retry ---------------------------------------------------------------

  const canRetry = useCallback((id: string): boolean => heldFiles.current.has(id), []);

  const retry = useCallback(
    (id: string): boolean => {
      const file = heldFiles.current.get(id);
      if (file === undefined) return false;
      // Back to `uploading` with a fresh clock, then the same file again.
      markImageRetrying(live.current.doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  // An upload still running when this board unmounts is stopped, so it cannot answer
  // into a document nobody is showing any more.
  useEffect(() => {
    const flights = inFlight.current;
    return () => {
      for (const upload of flights.values()) upload.abort();
      flights.clear();
    };
  }, []);

  return useMemo<ImageInsert>(
    () => ({
      isDragging,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      onPaste,
      openPicker,
      progress,
      retry,
      canRetry,
    }),
    [isDragging, onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, progress, retry, canRetry],
  );
}

/** The middle of the visible board area, in world units (paste and picker centre). */
function viewCentre(camera: Camera): Point {
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const height = typeof window === 'undefined' ? 800 : window.innerHeight;
  return screenToWorld(camera, { x: width / 2, y: height / 2 });
}

/**
 * The image's own pixel size, or null if these bytes will not decode. A rejected
 * decode is how an accepted-by-name file that is not really an image (a truncated
 * PNG, a disguised document that got past `File.type`) is caught on the client, and
 * the reason there is never a zero-sized or wrong-sized placeholder.
 */
async function decodeImage(file: File): Promise<ImageBitmap | null> {
  try {
    if (typeof createImageBitmap !== 'function') {
      // No image decoder in this environment (a bare jsdom): treat it as undecodable
      // rather than throw. Component tests install a stub, e2e runs in a real browser.
      return null;
    }
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/** The hidden `<input type=file accept=… multiple>` the picker is opened from. */
function createPickerInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = IMAGE_ACCEPTED_TYPES.join(',');
  input.style.display = 'none';
  // A stable handle for the file-chooser scenario: hidden, never looked at, but
  // addressable, so the picker path is testable end to end.
  input.dataset.testid = 'image-file-input';
  document.body.appendChild(input);
  return input;
}
