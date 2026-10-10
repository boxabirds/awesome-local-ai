import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type * as Y from 'yjs';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type LayoutAnchor,
} from '../../shared/objects/image';
import { deleteObjects } from '../../shared/board-model';
import { ASSET_API_PREFIX, IMAGE_MAX_PLACE_SIZE_WORLD } from '../../shared/config';
import type { ConnectionState } from '../sync/connectBoard';
import { IMAGE_ACCEPT_ATTRIBUTE, REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

/**
 * Adding images: drop, paste, picker (`image.insert`).
 *
 * One hook owns the whole life of an inserted image on the client that inserted it:
 * which files a person offered, which placeholders appeared on the board, which
 * uploads those placeholders are waiting for, and which files are still in memory
 * for a Retry. It writes no position and no size beyond the first placement -
 * moving and resizing an image is story 7's gesture.
 *
 * The order is fixed, because every step is what the next one is judged against:
 *
 * 1. may this client add at all - a board it may not edit, or a room it is not
 *    connected to, is answered before a single file is looked at (`image.offline`);
 * 2. `validateFiles` - size, count, then the magic numbers (`image.types`,
 *    `image.size_limit`, `image.count_limit`);
 * 3. `createImageBitmap` - the file is decoded, because a placeholder must be born
 *    at the size the finished image will be, and a file that will not decode must
 *    never be uploaded or added (`image.types`, TC-29);
 * 4. `layoutRow` + `createImagePlaceholders` - one row, one transaction, so one add
 *    is one undo step and the row arrives for everyone at once (`image.drop`);
 * 5. `uploadImage` per file, progress recorded as it arrives (`image.progress`).
 *
 * Progress and the kept files live here and nowhere else. The document says an
 * image is `uploading`; only this client knows *what percentage* of it has been
 * sent, and only this client can send it again - which is why a Retry belongs to
 * the person who dropped the file and a Remove belongs to anyone (`image.failed`).
 */

/* -------------------------------------------------------------------------- */
/* What an image object needs from the client that is adding it               */
/* -------------------------------------------------------------------------- */

/**
 * The board half of an image's state: where its bytes are served from, how much of
 * them this client has sent, and whether this client can send them again.
 *
 * A context, not a prop, because `registry.tsx` renders every object with one
 * shared props object (`ObjectProps`) and story 12 is not a reason to change what a
 * sticky note, a shape and an arrow are handed. An `ImageObject` reads this and
 * renders on its own - which is also why an image someone *else* added knows
 * nothing more than its own document status.
 */
export interface ImageAdditions {
  /** Where this browser fetches a stored asset from (`assets.api`). */
  assetUrlOf(assetKey: string): string;
  /** The fraction of this object's file this client has sent, or `undefined`. */
  progressFor(objectId: string): number | undefined;
  /** Is this object's file still in this client's memory (`image.failed.retry`)? */
  canRetry(objectId: string): boolean;
  /** Send it again. */
  retry(objectId: string): void;
  /**
   * Stop sending this object's file, and forget it (`image.remove`): the object is
   * being taken off the board, and a file still on its way to a board that no
   * longer has the object is work nobody will ever look at.
   */
  abandon(objectId: string): void;
  /** Who this client is, for `image.uploaderId`: whose upload is this? */
  readonly identityId: string;
}

const NO_ADDITIONS: ImageAdditions = {
  assetUrlOf: (assetKey) => `${ASSET_API_PREFIX}/${assetKey}`,
  progressFor: () => undefined,
  canRetry: () => false,
  retry: () => undefined,
  abandon: () => undefined,
  identityId: '',
};

const AdditionsContext = createContext<ImageAdditions>(NO_ADDITIONS);

/** What the board is adding to it (`image.object` renders through this). */
export function useImageAdditions(): ImageAdditions {
  return useContext(AdditionsContext);
}

export function ImageAdditionsProvider({
  additions,
  children,
}: {
  additions: ImageAdditions;
  children: React.ReactNode;
}) {
  return <AdditionsContext.Provider value={additions}>{children}</AdditionsContext.Provider>;
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

/** How long a message about an add stays on screen (`image.feedback`). */
export const IMAGE_TOAST_DISMISS_MS = 8_000;

/** The order the messages are shown in: the first reason a batch failed leads. */
const REASON_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

export interface ImageToast {
  readonly id: number;
  /** What went wrong. `decode` is a file that sniffed like an image and was not one. */
  readonly reason: FileRejection | 'offline';
  readonly message: string;
  /** How many files this message is about. */
  readonly count: number;
}

/* -------------------------------------------------------------------------- */
/* The hook                                                                   */
/* -------------------------------------------------------------------------- */

export interface ImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** Whose uploads these are (`image.uploaderId`). */
  identityId: string;
  /** Story 3's connection state, for the offline rule (`image.offline`). */
  connection: ConnectionState;
  /** False on a board this client may not edit (`persist.client_status`). */
  canEdit?: boolean;
  /**
   * The board is typing into something - a note, a text object, a label, an input.
   * A paste then belongs to that editor and no image is added (`image.paste`).
   */
  editing?: boolean;
  /** The camera, so a drop point becomes a board point (`image.drop`). */
  camera?: Camera | null;
  /** Where the board surface sits in the window, from `BoardSurface.origin`. */
  surfaceOrigin?: Point | null;
  /** The centre of the visible board, in world units: where a paste or pick goes. */
  viewCentre?: Point | null;
  /** The new objects become the selection. */
  select?: (ids: readonly string[]) => void;
  /** Open and close one undo step around one add (`image.insert`, TC-17). */
  undoBoundary?: () => void;
  /** The Image tool is over: the board goes back to Select (`tool.return`). */
  onToolReturn?: () => void;
}

export interface ImageInsert {
  /** Files over the board: the browser's own "open this file" is refused. */
  onDragOver(event: DragEvent): void;
  /** Files released over the board (`image.drop`). */
  onDrop(event: DragEvent): void;
  /** Files pasted onto the board (`image.paste`). */
  onPaste(event: ClipboardEvent): void;
  /** The Image button and the `i` shortcut (`image.pick`). */
  openPicker(): void;
  /**
   * The hidden file input `openPicker` opens (`image.pick`). The board renders it; it
   * is one element, reused, rather than one made per use.
   */
  readonly pickerInput: ReactElement;
  /**
   * The body all three entry points share, exposed so a test or a caller that has
   * the files already can add them at a chosen point with a chosen layout.
   */
  insertFiles(files: readonly File[], at?: Point | null, anchor?: LayoutAnchor): void;
  /** Upload progress this client has, per object id (`image.progress`). */
  readonly progress: ReadonlyMap<string, number>;
  progressFor(objectId: string): number | undefined;
  canRetry(objectId: string): boolean;
  retry(objectId: string): boolean;
  /** Stop an upload without deleting anything (`image.remove`, undone objects). */
  abandon(objectId: string): void;
  remove(objectId: string): void;
  readonly toasts: readonly ImageToast[];
  dismissToast(id: number): void;
  /** What the object layer renders with. */
  readonly additions: ImageAdditions;
}

/** Is this a room this client can put an image into? (`image.offline`) */
export function roomAcceptsImages(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

/** A decoded file's own pixel size, or the reason it has none. */
type Decoded =
  | { kind: 'ok'; width: number; height: number }
  /** No decoder in this environment (jsdom): the file is placed at the cap. */
  | { kind: 'unknown' }
  /** The file would not decode, so it is not an image this board can show. */
  | { kind: 'failed' };

function decodeOf(file: File): Promise<Decoded> {
  if (typeof createImageBitmap !== 'function') {
    return Promise.resolve({ kind: 'unknown' });
  }
  return createImageBitmap(file)
    .then((bitmap) => {
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close?.();
      return width > 0 && height > 0 ? { kind: 'ok' as const, width, height } : { kind: 'failed' as const };
    })
    .catch(() => ({ kind: 'failed' as const }));
}

const filesOfTransfer = (dataTransfer: DataTransfer | null): File[] => {
  if (!dataTransfer) {
    return [];
  }
  if (!Array.from(dataTransfer.types).includes('Files')) {
    return [];
  }
  return Array.from(dataTransfer.files);
};

/** Is a press or a paste landing in something a person is typing into? */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

export function useImageInsert(args: ImageInsertArgs): ImageInsert {
  const { doc, boardId, identityId } = args;

  // Every handler below lives for the life of the board and reads the newest
  // camera, connection and selection callbacks through a ref - the convention
  // every board hook in this app uses.
  const argsRef = useRef(args);
  argsRef.current = args;

  /** Object id -> fraction sent, as the browser reported it (`image.progress`). */
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** Object id -> the file it stands for, kept for Retry (`image.failed.retry`). */
  const files = useRef(new Map<string, File>());
  const handles = useRef(new Map<string, UploadHandle>());
  const lastPercent = useRef(new Map<string, number>());
  const [toasts, setToasts] = useState<ImageToast[]>([]);
  const toastId = useRef(0);
  const picker = useRef<HTMLInputElement | null>(null);

  // An upload belongs to the board it was started on. Leaving the board stops
  // sending files nobody on it will ever look at.
  useEffect(() => {
    const inFlight = handles.current;
    const started = files.current;
    const percents = lastPercent.current;
    return () => {
      for (const handle of inFlight.values()) {
        handle.abort();
      }
      inFlight.clear();
      started.clear();
      percents.clear();
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const say = useCallback((reason: ImageToast['reason'], message: string, count: number) => {
    toastId.current += 1;
    const toast: ImageToast = { id: toastId.current, reason, message, count };
    setToasts((current) => [...current, toast]);
  }, []);

  // A message is shown, then it goes away by itself (`image.feedback`).
  useEffect(() => {
    if (toasts.length === 0) {
      return undefined;
    }
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        setToasts((current) => current.filter((entry) => entry.id !== toast.id));
      }, IMAGE_TOAST_DISMISS_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const setFraction = useCallback((objectId: string, fraction: number) => {
    // Progress arrives dozens of times a second. A board re-render is only worth
    // it when the percentage a person is reading changes.
    const percent = Math.round(fraction * 100);
    if (lastPercent.current.get(objectId) === percent) {
      return;
    }
    lastPercent.current.set(objectId, percent);
    setProgress((current) => {
      const next = new Map(current);
      next.set(objectId, fraction);
      return next;
    });
  }, []);

  const clearFraction = useCallback((objectId: string) => {
    lastPercent.current.delete(objectId);
    setProgress((current) => {
      if (!current.has(objectId)) {
        return current;
      }
      const next = new Map(current);
      next.delete(objectId);
      return next;
    });
  }, []);

  /** One file, one placeholder, one upload - and the state that goes with it. */
  const send = useCallback(
    (objectId: string, file: File) => {
      files.current.set(objectId, file);
      const handle = uploadImage(boardId, file, (fraction) => setFraction(objectId, fraction));
      handles.current.set(objectId, handle);
      void handle.promise.then((result) => {
        handles.current.delete(objectId);
        // The object may have been removed, undone or moved to another board while
        // the request was in flight; the document is the only authority on whether
        // this object is still there to be told about its own upload.
        if (!files.current.has(objectId)) {
          return;
        }
        if (result.kind === 'ok') {
          files.current.delete(objectId);
          markImageReady(doc, objectId, result.assetKey, result.contentType);
        } else {
          // Kept, so the Retry on the object can send the very same file again.
          markImageFailed(doc, objectId);
        }
        clearFraction(objectId);
      });
    },
    [boardId, clearFraction, doc, setFraction],
  );

  /**
   * The body of all three entry points.
   *
   * `at` is where the layout starts: the point a drop landed on with `top-left`, or
   * the centre of the visible board with `centre` for a paste and a pick.
   */
  const insertFiles = useCallback(
    (offered: readonly File[], at?: Point | null, anchor: LayoutAnchor = 'top-left') => {
      const current = argsRef.current;
      if (offered.length === 0) {
        current.onToolReturn?.();
        return;
      }
      if (current.canEdit === false) {
        return;
      }
      // The offline answer comes first, so a board this client cannot reach never
      // gains placeholders it could never fill (TC-19).
      if (!roomAcceptsImages(current.connection)) {
        say('offline', REJECTION_MESSAGES.offline, offered.length);
        current.onToolReturn?.();
        return;
      }

      void (async () => {
        const { accepted, rejections } = await validateFiles(offered);

        // One message per reason the batch failed, in the order the product names
        // them, each saying how many files it is about (`image.feedback`).
        const counted = new Map<FileRejection, number>();
        for (const rejection of rejections) {
          counted.set(rejection.reason, (counted.get(rejection.reason) ?? 0) + 1);
        }
        for (const reason of REASON_ORDER) {
          const count = counted.get(reason);
          if (count) {
            say(reason, REJECTION_MESSAGES[reason], count);
          }
        }
        if (accepted.length === 0) {
          current.onToolReturn?.();
          return;
        }

        // Decode before placing: a placeholder is created at the size the finished
        // image will be, so nothing jumps when the bytes arrive (`image.uploading`).
        const decoded = await Promise.all(accepted.map((file) => decodeOf(file)));
        const unusable = decoded.filter((entry) => entry.kind === 'failed').length;
        if (unusable > 0) {
          // A file that sniffed like an image and is not one gets the same message
          // as a file that was never an image, and is not added at all (TC-29).
          say('type', REJECTION_MESSAGES.type, unusable);
        }

        const usable: { file: File; width: number; height: number }[] = [];
        accepted.forEach((file, index) => {
          const entry = decoded[index];
          if (!entry) {
            return;
          }
          if (entry.kind === 'ok') {
            usable.push({ file, width: entry.width, height: entry.height });
          } else if (entry.kind === 'unknown') {
            usable.push({ file, width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD });
          }
        });
        if (usable.length === 0) {
          current.onToolReturn?.();
          return;
        }

        const sizes = usable.map((item) => {
          const size = placementSize(item.width, item.height);
          return size ?? { width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD };
        });
        const centre = at ?? current.viewCentre ?? { x: 0, y: 0 };
        const rects = layoutRow(sizes, centre, anchor);

        const items = rects.map((rect, index) => ({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          naturalWidth: usable[index]!.width,
          naturalHeight: usable[index]!.height,
        }));

        current.undoBoundary?.();
        const ids = createImagePlaceholders(doc, items, identityId, Date.now());
        current.undoBoundary?.();

        ids.forEach((id, index) => {
          const file = usable[index]?.file;
          if (file) {
            send(id, file);
          }
        });

        if (ids.length > 0) {
          current.select?.(ids);
        }
        current.onToolReturn?.();
      })();
    },
    [identityId, doc, say, send],
  );

  /** A drop point in world units: the pointer, less where the board starts. */
  const worldOf = (event: DragEvent): Point | null => {
    const current = argsRef.current;
    const camera = current.camera;
    if (!camera) {
      return null;
    }
    const origin = current.surfaceOrigin ?? { x: 0, y: 0 };
    return screenToWorld(camera, { x: event.clientX - origin.x, y: event.clientY - origin.y });
  };

  const onDragOver = useCallback((event: DragEvent) => {
    if (argsRef.current.canEdit === false) {
      return;
    }
    if (filesOfTransfer(event.dataTransfer).length > 0) {
      // Without this the browser's own answer to a dropped file is to open the file
      // and lose the board.
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const filesOffered = filesOfTransfer(event.dataTransfer);
      if (filesOffered.length === 0) {
        return;
      }
      event.preventDefault();
      insertFiles(filesOffered, worldOf(event), 'top-left');
    },
    [insertFiles],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const current = argsRef.current;
      const pasted = filesOfTransfer(event.clipboardData);
      if (pasted.length === 0) {
        return; // pasted text is a paste for whatever has focus, not an add
      }
      if (current.editing || isTypingTarget(event.target)) {
        return; // a note, a label or a text object is being typed into (`image.paste`)
      }
      event.preventDefault();
      insertFiles(pasted, current.viewCentre, 'centre');
    },
    [insertFiles],
  );

  /**
   * The picker (`image.pick`).
   *
   * One hidden file input, kept in the tree and reused: it is not a control on the
   * board, it is the operating system's file list, and a control that is made and
   * thrown away for each use is a control that can be left behind. The offline answer
   * comes *before* it is opened, so a reconnecting board never asks a person to choose
   * files it then refuses to take.
   */
  const openPicker = useCallback(() => {
    const current = argsRef.current;
    if (current.canEdit === false) {
      return;
    }
    if (!roomAcceptsImages(current.connection)) {
      say('offline', REJECTION_MESSAGES.offline, 1);
      return;
    }
    const input = picker.current;
    if (input === null) {
      return;
    }
    // Cleared first, so choosing the same file twice is two adds.
    input.value = '';
    input.click();
  }, [say]);

  /** What the file list hands back. */
  const takePickedFiles = useCallback(
    (input: HTMLInputElement) => {
      const chosen = input.files === null ? [] : Array.from(input.files);
      input.value = '';
      if (chosen.length > 0) {
        insertFiles(chosen, null, 'centre');
      }
    },
    [insertFiles],
  );

  const pickerClosed = useCallback(() => {
    argsRef.current.onToolReturn?.();
  }, []);

  const attachPicker = useCallback(
    (node: HTMLInputElement | null) => {
      const previous = picker.current;
      if (previous !== null && previous !== node) {
        previous.removeEventListener('cancel', pickerClosed);
      }
      picker.current = node;
      if (node !== null) {
        node.addEventListener('cancel', pickerClosed);
      }
    },
    [pickerClosed],
  );

  const canRetry = useCallback((objectId: string) => files.current.has(objectId), []);

  const retry = useCallback(
    (objectId: string) => {
      const file = files.current.get(objectId);
      if (!file) {
        return false;
      }
      handles.current.get(objectId)?.abort();
      handles.current.delete(objectId);
      clearFraction(objectId);
      // `uploading` again, with a clock that starts now, before the bytes do: the
      // board and this client agree about who is sending before anything is sent.
      markImageRetrying(doc, objectId, Date.now());
      send(objectId, file);
      return true;
    },
    [clearFraction, doc, send],
  );

  const abandon = useCallback(
    (objectId: string) => {
      handles.current.get(objectId)?.abort();
      handles.current.delete(objectId);
      files.current.delete(objectId);
      clearFraction(objectId);
    },
    [clearFraction],
  );

  const remove = useCallback(
    (objectId: string) => {
      abandon(objectId);
      const current = argsRef.current;
      current.undoBoundary?.();
      deleteObjects(doc, [objectId]);
      current.undoBoundary?.();
    },
    [abandon, doc],
  );

  const progressFor = useCallback((objectId: string) => progress.get(objectId), [progress]);

  const additions = useMemo<ImageAdditions>(
    () => ({
      assetUrlOf: (assetKey) => `${ASSET_API_PREFIX}/${assetKey}`,
      progressFor: (objectId) => progress.get(objectId),
      canRetry: (objectId) => files.current.has(objectId),
      retry: (objectId) => {
        retry(objectId);
      },
      abandon,
      identityId,
    }),
    [abandon, identityId, progress, retry],
  );

  // The board's own drop and paste surface: `window`, like every tool in this app,
  // so a file released over the toolbar or the zoom control is an add and not a
  // browser navigation (`image.drop`).
  useEffect(() => {
    const onPasteEvent = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPasteEvent);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPasteEvent);
    };
  }, [onDragOver, onDrop, onPaste]);

  const pickerInput = (
    <input
      ref={attachPicker}
      type="file"
      multiple
      accept={IMAGE_ACCEPT_ATTRIBUTE}
      className="image-picker"
      data-testid="image-picker-input"
      aria-label="Choose images to add to the board"
      onChange={(event) => {
        takePickedFiles(event.currentTarget);
      }}
    />
  );

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    pickerInput,
    insertFiles,
    progress,
    progressFor,
    canRetry,
    retry,
    abandon,
    remove,
    toasts,
    dismissToast,
    additions,
  };
}
