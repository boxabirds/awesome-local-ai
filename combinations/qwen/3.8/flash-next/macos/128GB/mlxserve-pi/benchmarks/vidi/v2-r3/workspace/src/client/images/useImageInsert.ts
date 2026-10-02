/*! Getting files from a person's computer onto the board (story 12).
 *
 * Three ways in — dropped on the board, pasted from the clipboard, picked from the
 * file dialogue — and one flow, because a picture does not care how it arrived:
 *
 *   refuse what the board cannot keep → ask the bytes how big a picture they are →
 *   write a placeholder for each → send each one, and mark it ready or failed when
 *   the answer comes
 *
 * ## Why the placeholder comes before the upload
 *
 * The image is on the board before its bytes are anywhere. That is what makes a
 * drop feel instant, what gives everybody something to look at while a photo goes
 * up, and what leaves something honest behind when the upload never finishes: an
 * object which says it is still uploading, rather than a picture that was silently
 * never added (image.status_machine).
 *
 * ## What is kept where
 *
 * The `File` of an upload is kept in a ref, not in the document. It is a hundred
 * megabytes of somebody's camera roll and it is not board state; and it is the
 * reason a retry is only possible in the tab that has the file. A reload loses it,
 * which is correct — after a reload the file is gone from that tab too, and the
 * board says "Image upload didn't finish" instead of pretending it could fetch a
 * file from a browser that no longer has it (image.retry).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type RefObject,
} from 'react';
import type * as Y from 'yjs';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  layoutRow,
  placementSize,
  type ImageItem,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point, Rect, Size } from '../../shared/geometry';
import type { Camera, Size as ViewportSize } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { showToast } from '../ui/Toast';
import { REJECTION_MESSAGES, REJECTION_ORDER, validateFiles } from './validateFiles';
import { uploadImage, type ImageUpload } from './uploadImage';

/** The three ways a file arrives, and the one thing they have in common: the board
 *  has to know whether it can be told about a file at all. */
export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** The camera the drop is measured against: where a picture is dropped is where
   *  it goes, and where the view is looking is where a pasted one goes. */
  camera: Camera;
  /** The size of the board area in screen pixels, with the camera: the middle of
   *  what this person can see, which is where a picture they did not drop goes. */
  viewport: ViewportSize;
  /** Only a live board may be told about a file. */
  connection: ConnectionState;
  /** This person's id for this visit. It goes on the placeholder, and it is what
   *  every other board compares against to know whether *you* are the one still
   *  uploading. */
  identityId: string;
}

/** What the board is handed: the gestures to wire up and the state to draw from. */
export interface UseImageInsertResult {
  /** The files, and where they went. Never throws: a file the board could not
   *  take is reported in the toasts and leaves no placeholder behind.
   *  `dropPoint` is the point of a drop in board units; without one — a paste, a
   *  pick — the row is placed in the middle of what the person is looking at. */
  addFiles(files: readonly File[], dropPoint?: Point | null): Promise<string[]>;
  /** A drag came onto, moved over, or left the board. Only a drag carrying files
   *  is a drag the board highlights. */
  onDragEnter(e: ReactDragEvent): void;
  onDragOver(e: ReactDragEvent): void;
  onDragLeave(e: ReactDragEvent): void;
  /** A drop: the files go where the pointer was. */
  onDrop(e: ReactDragEvent): void;
  /** True while files are being dragged over the board. */
  dragging: boolean;
  /** The Image button and the I key: the system's own file dialogue. */
  openPicker(): void;
  /** The input the picker opened — the board renders it, this hook clicks it. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** What the picker answered with. */
  onPickedFiles(files: readonly File[]): void;
  /** A paste from the clipboard, watched on the window. */
  onPaste(e: ClipboardEvent): void;
  /** How far each upload has got, as a fraction of its file. */
  progress: ReadonlyMap<string, number>;
  /** Try that upload again, from the file still held in this tab. False when this
   *  tab is not the one that has the file, which is the only reason Remove is left
   *  as the thing to do about it. */
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

/** A live connection: one that could be told about a file right now. */
export function isLiveConnection(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

/** The files a drag or a paste carries, or none when it carries other things. */
function filesOf(dataTransfer: DataTransfer | null): File[] {
  if (dataTransfer === null) return [];
  const files = dataTransfer.files;
  if (files === undefined || files === null) return [];
  return Array.from(files);
}

/** Is this drag bringing files rather than a bit of selected text? */
function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer === null) return false;
  if (dataTransfer.files !== undefined && dataTransfer.files !== null && dataTransfer.files.length > 0) {
    return true;
  }
  const types = dataTransfer.types;
  if (types === undefined || types === null) return false;
  return Array.from(types).includes('Files');
}

/** A board point from a pointer's screen point, measured against the surface the
 *  event landed on — the same way every other point on the board is measured. */
function boardPointOf(e: ReactDragEvent, camera: Camera): Point {
  const target = e.currentTarget as HTMLElement | null;
  const rect = target !== null && typeof target.getBoundingClientRect === 'function'
    ? target.getBoundingClientRect()
    : null;
  const x = rect === null ? e.clientX : e.clientX - rect.left;
  const y = rect === null ? e.clientY : e.clientY - rect.top;
  return { x: camera.x + x / camera.zoom, y: camera.y + y / camera.zoom };
}

/** What the browser says a decoded picture is, or null for bytes which are not one. */
async function decodeSize(file: File): Promise<Size | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    // An image decodes to nothing when it is not an image, and a browser that has
    // never heard of the format says so here rather than at the drop.
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    // The bitmap was only ever wanted for its numbers.
    if (typeof bitmap.close === 'function') bitmap.close();
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * The insert flow, wired to one board's document.
 *
 * Everything is written through `shared/objects/image` and nothing is written
 * anywhere else: this hook does not keep a list of images of its own, because a
 * board is what it is by its document, and a second copy of the truth would be a
 * second thing to keep in step.
 */
export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const argsRef = useRef(args);
  argsRef.current = args;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const filesById = useRef(new Map<string, File>());
  const inflight = useRef(new Map<string, ImageUpload>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** One upload's bar. The map is replaced rather than edited so that React sees
   *  a new value; the board is keyed by object id, so a bar never jumps between
   *  two pictures. */
  const changeProgress = useCallback((id: string, fraction: number | null): void => {
    setProgress((current) => {
      const next = new Map(current);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  /**
   * Send one file, and write what comes back onto the object.
   *
   * The write is `markImageReady` or `markImageFailed`, which is the only way an
   * `uploading` object is ever left — and it happens whatever else has gone on
   * meanwhile, because the answer to an upload that was sent is a fact about the
   * store which is worth recording even if the person has moved on.
   */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const a = argsRef.current;
      inflight.current.get(id)?.abort();
      const upload = uploadImage(a.boardId, file, (fraction) => {
        changeProgress(id, fraction);
      });
      inflight.current.set(id, upload);
      void upload.promise.then((result) => {
        if (inflight.current.get(id) === upload) inflight.current.delete(id);
        changeProgress(id, null);
        if (result.kind === 'ok') markImageReady(a.doc, id, result.assetKey);
        else markImageFailed(a.doc, id);
      });
    },
    [changeProgress],
  );

  /** The middle of what the person is looking at, in board units: where a paste or
   *  a pick goes, because nobody aims the middle of their own view. */
  const viewCentre = useCallback((): Point => {
    const { camera, viewport } = argsRef.current;
    const width = viewport.width > 0 ? viewport.width : 0;
    const height = viewport.height > 0 ? viewport.height : 0;
    return { x: camera.x + width / 2 / camera.zoom, y: camera.y + height / 2 / camera.zoom };
  }, []);

  const addFiles = useCallback(
    async (files: readonly File[], dropPoint?: Point | null): Promise<string[]> => {
      const a = argsRef.current;
      // Nothing is measured, decoded or written while there is nowhere to send it.
      // The same words for all three ways in, including the picker, whose dialogue
      // has already been and gone by the time anybody knows whether it was answered.
      if (!isLiveConnection(a.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return [];
      }

      const { accepted, rejections } = validateFiles(files);
      const refused = new Set(rejections);

      // The second half of "is this a picture?": bytes which do not decode are
      // refused with the same words, whatever the browser was told to believe.
      const decoded: { file: File; size: Size }[] = [];
      for (const file of accepted) {
        const size = await decodeSize(file);
        if (size === null) {
          refused.add('type');
          continue;
        }
        decoded.push({ file, size });
      }

      // One message per reason, in the order the reasons matter.
      for (const kind of REJECTION_ORDER) {
        if (refused.has(kind)) showToast(REJECTION_MESSAGES[kind]);
      }
      if (decoded.length === 0) return [];

      const sizes = decoded.map((item) => placementSize(item.size.width, item.size.height));
      const point = dropPoint ?? null;
      const rects: Rect[] = layoutRow(sizes, point ?? viewCentre(), point === null ? 'centre' : 'top-left');

      const items: ImageItem[] = [];
      const uploadable: File[] = [];
      for (let index = 0; index < decoded.length && index < rects.length; index++) {
        items.push({
          rect: rects[index]!,
          naturalWidth: decoded[index]!.size.width,
          naturalHeight: decoded[index]!.size.height,
          contentType: decoded[index]!.file.type,
        });
        uploadable.push(decoded[index]!.file);
      }

      // One transaction, so twenty files arrive as one thing for everybody else
      // and are undone as one thing by the person who dropped them.
      const ids = createImagePlaceholders(a.doc, items, a.identityId, Date.now());
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index]!;
        filesById.current.set(id, uploadable[index]!);
        changeProgress(id, 0);
        startUpload(id, uploadable[index]!);
      }
      return ids;
    },
    [changeProgress, startUpload, viewCentre],
  );

  /**
   * A drop on the board. The event is stopped and prevented whatever came in it:
   * a browser which is not told otherwise opens the dropped file in the page
   * instead, and a person who meant to put a picture on a board would find
   * themselves having navigated away from it.
   */
  const onDrop = useCallback(
    (e: ReactDragEvent): void => {
      e.preventDefault();
      e.stopPropagation?.();
      dragDepth.current = 0;
      setDragging(false);
      const files = filesOf(e.dataTransfer ?? null);
      if (files.length === 0) return;
      const point = boardPointOf(e, argsRef.current.camera);
      void addFiles(files, point);
    },
    [addFiles],
  );

  const onDragEnter = useCallback((e: ReactDragEvent): void => {
    if (!isFileDrag(e.dataTransfer ?? null)) return;
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  // `preventDefault` is what says "this is a place files may be dropped", and it
  // is said on every dragover rather than once, because a browser asks again.
  const onDragOver = useCallback((e: ReactDragEvent): void => {
    if (!isFileDrag(e.dataTransfer ?? null)) return;
    e.preventDefault();
    if (e.dataTransfer !== null && e.dataTransfer !== undefined) e.dataTransfer.dropEffect = 'copy';
    dragDepth.current = Math.max(dragDepth.current, 1);
    setDragging(true);
  }, []);

  // A drag which leaves the board stops being a promise of a picture. The depth is
  // counted because a drag crosses the board's own children on its way out, and
  // each crossing is not a leaving.
  const onDragLeave = useCallback((e: ReactDragEvent): void => {
    if (!isFileDrag(e.dataTransfer ?? null)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  /**
   * The file dialogue. A board which cannot be told about a file does not open a
   * dialogue at all: a picker which let somebody choose a file and then refused it
   * would be a dialogue that wasted their time on purpose.
   */
  const openPicker = useCallback((): void => {
    const a = argsRef.current;
    if (!isLiveConnection(a.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = fileInputRef.current;
    if (input === null) return;
    // Cleared first, so choosing the same file twice is two choices: an input that
    // already holds the file would report nothing happening.
    input.value = '';
    input.click();
  }, []);

  const onPickedFiles = useCallback(
    (files: readonly File[]): void => {
      if (files.length === 0) return;
      void addFiles(files, null);
    },
    [addFiles],
  );

  /**
   * A paste on the window. Words typed into a sticky note are pasted into the
   * note and are not a picture on the board, so a paste whose focus is in a text
   * field is left entirely alone — not refused, which would be a toast about the
   * sentence somebody was writing.
   */
  const onPaste = useCallback(
    (e: ClipboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLElement) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const files = filesOf(e.clipboardData ?? null);
      if (files.length === 0) return;
      // Only a paste of images is ours: a paste of files which are not images is
      // answered with the same words as a drop of them, because it is the same
      // question.
      e.preventDefault?.();
      void addFiles(files, null);
    },
    [addFiles],
  );

  // The paste listener, on the window, for as long as this board is open.
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;
  useEffect(() => {
    const handler = (e: Event): void => pasteRef.current(e as ClipboardEvent);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);

  // An upload which was in flight when the board went away is not going to be
  // written to by anybody, and a browser left sending it would be sending bytes to
  // a document that no longer exists.
  useEffect(
    () => () => {
      for (const upload of inflight.current.values()) upload.abort();
      inflight.current.clear();
    },
    [],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesById.current.get(id);
      // The file, or nothing: this tab cannot upload what this tab does not have,
      // and the honest answer is `false` so the board offers Remove instead.
      if (file === undefined) return false;
      const a = argsRef.current;
      // The object goes back to `uploading` before the request goes out, so the
      // board that shows it shows the truth about the attempt rather than about
      // the last one.
      markImageRetrying(a.doc, id, Date.now());
      changeProgress(id, 0);
      startUpload(id, file);
      return true;
    },
    [changeProgress, startUpload],
  );

  const canRetry = useCallback((id: string): boolean => filesById.current.has(id), []);

  return {
    addFiles,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    dragging,
    openPicker,
    fileInputRef,
    onPickedFiles,
    onPaste,
    progress,
    retry,
    canRetry,
  };
}

/** What the file picker offers: the formats, from the one list the board keeps. */
export const IMAGE_PICKER_ACCEPT = IMAGE_ACCEPTED_TYPES.join(',');
