import {
  createContext,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import * as Y from 'yjs';

import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';

/**
 * Adding images to a board (`image.drop`, `image.paste`, `image.pick`,
 * `image.uploading`, `image.upload_failure`, `image.rate_limit`).
 *
 * One function does the work for all three entrances, because after the files
 * arrive they are the same job: refuse what cannot be added, measure what can,
 * put a placeholder on the board, then send the bytes. Two rules shape it:
 *
 * **Nothing is added while the board is not reachable** (`image.offline`). A
 * placeholder is shared data, and one that can never be filled is worse than a
 * refusal. So the connection is asked first, before a single object exists.
 *
 * **The placeholder exists before the upload finishes, and only once.** It is
 * written in one `LOCAL_ORIGIN` transaction — the whole batch is one undo step —
 * and its outcome is written later with an untracked origin, so an upload that
 * lands two minutes from now does not change what Ctrl+Z means.
 *
 * The `File` of every upload is kept in memory so Retry can send the same bytes
 * without asking again. That map dies with the page, which is exactly why a
 * failed image reloaded from elsewhere offers Remove and not Retry.
 */

/** How long a refusal stays on screen before it goes away by itself. */
export const IMAGE_TOAST_VISIBLE_MS = 8_000;

/** The board area the picker and paste are centred in. */
const VIEWPORT_SELECTOR = '[data-testid="board-viewport"]';

/** Where a batch starts, and how. */
export type AddOrigin =
  | { kind: 'point'; at: Point }
  | { kind: 'centre' };

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** The board camera, to turn a drop point into world coordinates. */
  camera: Camera;
  /** Live connection state: an add needs a board that can be reached. */
  connection: ConnectionState;
  identityId: string;
}

export interface UseImageInsert {
  /** Drag handlers for the board area. Non-file drags are left alone entirely. */
  onDragEnter(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
  onDragLeave(event: DragEvent): void;
  onDrop(event: DragEvent): void;
  /** Paste handler, ignored while a text editor has focus (`image.paste`). */
  onPaste(event: ClipboardEvent): void;
  /** The Image button and the `i` shortcut (`image.pick`). */
  openPicker(): void;
  /** The hidden input the picker drives; the caller renders this. */
  fileInput: ReactElement;
  /** Upload progress by object id, for the uploader's own view only. */
  progress: ReadonlyMap<string, number>;
  /** True while files (not text) are being dragged over the board. */
  isDragOver: boolean;
  /** Messages to show at the bottom of the board. */
  toasts: readonly string[];
  /** Send the same bytes again. False when they are no longer held. */
  retry(id: string): boolean;
  /** Whether Retry is offered for this object at all. */
  canRetry(id: string): boolean;
}

/** The part of the insert state an image needs to draw itself. */
export const ImageInsertContext = createContext<UseImageInsert | null>(null);

/** A file that passed validation, with the size its picture reported. */
interface Measured {
  file: File;
  naturalWidth: number;
  naturalHeight: number;
}

const ACCEPT_ATTR = IMAGE_ACCEPTED_TYPES.join(',');

/** Every accepted type, so the order of refusal messages is stable. */
const REJECTION_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

/** Does this drag carry files? Text and link drags are not ours to answer. */
function hasFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (dataTransfer == null) return false;
  const types = dataTransfer.types;
  if (types == null) return false;
  for (const type of Array.from(types)) if (type === 'Files') return true;
  return false;
}

/** The image files of a drop or paste, as a plain array. */
function filesOf(dataTransfer: DataTransfer | null | undefined): File[] {
  if (dataTransfer == null) return [];
  const { files } = dataTransfer;
  if (files == null) return [];
  return Array.from(files);
}

/**
 * The picture's own pixel size, from a real decode (`image.place_size`,
 * `image.types`). A file that will not decode is not an image whatever it is
 * called, and is refused with the type message — the same message the server
 * would have answered with.
 */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Is the board somewhere to add to right now (`image.offline`)? */
const reachable = (connection: ConnectionState): boolean =>
  connection === 'connected' || connection === 'confirmed';

export function useImageInsert(args: UseImageInsertArgs): UseImageInsert {
  const { doc, boardId, camera, connection, identityId } = args;

  // The latest arguments, read by callbacks that must stay stable so that the
  // board's event handlers are never re-attached mid-drag.
  const latest = useRef({ doc, boardId, camera, connection, identityId });
  useEffect(() => {
    latest.current = { doc, boardId, camera, connection, identityId };
  });

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [toasts, setToasts] = useState<readonly { key: number; message: string }[]>([]);
  const [isDragOver, setDragOver] = useState(false);

  /** The bytes of every upload this session started, for Retry. */
  const files = useRef(new Map<string, File>());
  const running = useRef(new Map<string, UploadHandle>());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toastKey = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const held = files.current;
    const uploads = running.current;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      for (const upload of uploads.values()) upload.abort();
      uploads.clear();
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      held.clear();
    };
  }, []);

  const say = useCallback((message: string): void => {
    const key = (toastKey.current += 1);
    setToasts((current) => [...current, { key, message }]);
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.key !== key));
      timers.current.delete(timer);
    }, IMAGE_TOAST_VISIBLE_MS);
    timers.current.add(timer);
  }, []);

  /** One upload, from start to the status it earned. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const current = latest.current;
      const handle = uploadImage(current.boardId, file, (fraction) => {
        if (!mounted.current) return;
        setProgress((previous) => new Map(previous).set(id, fraction));
      });
      running.current.set(id, handle);
      void handle.promise.then((result) => {
        if (running.current.get(id) === handle) running.current.delete(id);
        if (!mounted.current) return;
        // The bar is not shown any more either way; the object's own status is
        // what everyone else sees.
        setProgress((previous) => {
          if (!previous.has(id)) return previous;
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
        if (result.kind === 'ok') {
          markImageReady(current.doc, id, result.assetKey);
          files.current.delete(id);
          return;
        }
        markImageFailed(current.doc, id);
        if (result.kind === 'rate_limited') say(REJECTION_MESSAGES.rate);
      });
    },
    [say],
  );

  /**
   * The whole add: gate, validate, measure, place, upload.
   *
   * Every failure leaves the board exactly as it was and says why; a partially
   * acceptable batch adds the part that works and says what was refused.
   */
  const addFiles = useCallback(
    async (incoming: readonly File[], origin: AddOrigin): Promise<void> => {
      const current = latest.current;
      if (!reachable(current.connection)) {
        say(REJECTION_MESSAGES.offline);
        return;
      }
      if (incoming.length === 0) return;

      const { accepted, rejections } = validateFiles(incoming);
      for (const rejection of REJECTION_ORDER) {
        if (rejections.has(rejection)) say(REJECTION_MESSAGES[rejection]);
      }
      if (accepted.length === 0) return;

      // The decode is the last honest check the browser can make: a file whose
      // pixels cannot be read cannot be placed at the right size either.
      const measured: Measured[] = [];
      let undecodable = false;
      for (const file of accepted) {
        const size = await measure(file);
        if (size === null) {
          undecodable = true;
          continue;
        }
        measured.push({ file, naturalWidth: size.width, naturalHeight: size.height });
      }
      if (undecodable) say(REJECTION_MESSAGES.type);
      if (measured.length === 0 || !mounted.current) return;

      const start =
        origin.kind === 'point' ? origin.at : centreOf(current.camera);
      const rects = layoutRow(
        measured.map((item) => placementSize(item.naturalWidth, item.naturalHeight)),
        start,
        origin.kind === 'point' ? 'top-left' : 'centre',
      );
      const ids = createImagePlaceholders(
        current.doc,
        measured.map((item, index) => ({
          rect: rects[index]!,
          naturalWidth: item.naturalWidth,
          naturalHeight: item.naturalHeight,
          contentType: item.file.type,
        })),
        current.identityId,
        Date.now(),
      );

      // Every file of the batch starts now: they are on their own, and one slow
      // picture must not hold up the others.
      measured.forEach((item, index) => {
        const id = ids[index];
        if (id === undefined) return;
        files.current.set(id, item.file);
        startUpload(id, item.file);
      });
    },
    [say, startUpload],
  );

  const onDragEnter = useCallback((event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) return;
    // The default for a file drag is "open this file in the browser"; saying
    // otherwise is what makes the drop land here instead.
    event.preventDefault();
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    // The copy cursor: the pointer itself promises a copy, not a move (`image.drop`).
    try {
      event.dataTransfer!.dropEffect = 'copy';
    } catch {
      // A read-only DataTransfer (some synthetic events) has no effect to set.
    }
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) return;
    // Moving between children of the board is not leaving it.
    const target = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (target != null && next != null && target.contains(next)) return;
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent): void => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      setDragOver(false);
      const dropped = filesOf(event.dataTransfer);
      if (dropped.length === 0) return;
      const target = event.currentTarget as HTMLElement | null;
      const rect = target?.getBoundingClientRect?.();
      // The top-left of the first image lands where the pointer was (`image.drop`).
      const at: Point = {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
      };
      void addFiles(dropped, { kind: 'point', at });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent): void => {
      // Pasting a line of text into a note is not an image request.
      const target = event.target as HTMLElement | null;
      if (
        target != null &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      const files = filesOf(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      // A pasted image has no drop point, so it goes where the user is looking.
      void addFiles(files, { kind: 'centre' });
    },
    [addFiles],
  );

  const openPicker = useCallback((): void => {
    // Synchronously inside the click or key press: the file picker is only
    // allowed to open while the browser still believes the user asked.
    inputRef.current?.click();
  }, []);

  const onPickFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const picked = Array.from(event.currentTarget.files ?? []);
      // Cleared so choosing the same file twice is still a change.
      event.currentTarget.value = '';
      void addFiles(picked, { kind: 'centre' });
    },
    [addFiles],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (file === undefined) return false;
      if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  const canRetry = useCallback((id: string): boolean => files.current.has(id), []);

  // Built with `createElement` so this module stays a `.ts` file, as the design
  // names it: a hook that hands back one hidden input does not need JSX syntax.
  const fileInput = useMemo(
    () =>
      createElement('input', {
        ref: inputRef,
        type: 'file',
        accept: ACCEPT_ATTR,
        multiple: true,
        'data-testid': 'image-file-input',
        className: 'board-image-input',
        tabIndex: -1,
        'aria-hidden': true,
        onChange: onPickFiles,
      }),
    [onPickFiles],
  );

  const messages = useMemo(() => toasts.map((toast) => toast.message), [toasts]);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    fileInput,
    progress,
    isDragOver,
    toasts: messages,
    retry,
    canRetry,
  };
}

/** The middle of the visible board, in world coordinates. */
function centreOf(camera: Camera): Point {
  const element = document.querySelector(VIEWPORT_SELECTOR) as HTMLElement | null;
  const rect = element?.getBoundingClientRect?.();
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  return screenToWorld(camera, { x: width / 2, y: height / 2 });
}
