/**
 * The three ways a picture gets onto this board, and the one way it gets sent.
 *
 * Everything here is about *gestures and their consequences*: a drag over the board, a drop, a paste, a
 * file picker, a Retry button. The rules those gestures obey - which files may be added, how big a picture
 * may be, where a row of them goes, what an object's status is allowed to become - belong to
 * {@link ../../shared/objects/image} and {@link ./validateFiles}, and this file calls them rather than
 * repeating them. What is genuinely here is the state a gesture needs and cannot get from the document:
 *
 * - **which files are still in this browser's memory**, because Retry re-sends the file the person handed
 *   the board, and the only place those bytes exist after a failed upload is this tab. A reload loses them,
 *   which is why a failed upload survives a reload (it is in the document) while its Retry button does not
 *   (it is not).
 * - **how far each upload has got**, because progress is a property of a transfer, not of a board: it is
 *   deliberately *not* written to the document. Twenty people watching would get a hundred updates a second
 *   for something only the person who dropped the file can see.
 * - **what to say about the files that could not be added**, which is a message shown once, in one place,
 *   rather than a field on twenty objects.
 *
 * The order inside {@link addFiles} is the order the PRD states, and it is worth following line by line:
 * the connection is asked about first (there may be nowhere to send anything), then the files are filtered,
 * then the survivors are decoded to learn their shape, then one transaction gives them all a place on the
 * board, and only then do the uploads start. The two halves of that order matter for different reasons:
 * nothing is created until something is known to be acceptable, and nothing is uploaded until everything
 * that will be created has been created, so that the batch is one change to the document.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import type { UndoController } from '../board/undo';
import {
  IMAGE_ACCEPT_EXTENSIONS,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImagePlacement,
} from '../../shared/objects/image';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage, type UploadResult } from './uploadImage';

/** How long a message stays on screen. Long enough to read twice, short enough not to outstay its topic. */
const TOAST_MS = 8000;

/**
 * The file picker's `accept`, built from the same list the validator checks so the two cannot drift - and
 * said twice over, because a dialog needs the extensions to filter on and the report needs the types to
 * check against: `.jpeg` and `.jpg` are one format with two names, which is the whole reason both are here.
 */
export const IMAGE_PICKER_ACCEPT = [...IMAGE_ACCEPT_EXTENSIONS, ...IMAGE_ACCEPTED_TYPES].join(',');

/** Where a batch is put down: at the pointer, or spread around a point. */
type Placement = { anchor: 'top-left'; point: Point } | { anchor: 'centre'; point: Point };

/** The states in which a file could be uploaded if somebody asked. */
function isConnected(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

export interface ImageInsertOptions {
  doc: Y.Doc;
  /** The board the bytes belong to, which is also the address they are posted to. */
  boardId: string | undefined;
  /** To turn the point of a drop into a place on the board. */
  camera: Camera;
  /** The gate at the front door: a board that is not connected uploads nothing. */
  connection: ConnectionState;
  /** Who these images belong to, recorded on each object as its uploader. */
  identityId: string;
  /** Size of the board area, to put a pasted or picked batch in the middle of what is on screen. */
  viewport: Size;
  /** Say where one batch begins and ends, so the whole batch comes back with one Ctrl+Z. */
  undo?: UndoController;
  /** A batch was created: the board may want those objects to be the selection, the way it does for a drawn shape. */
  onAdded?(ids: string[]): void;
  /** The clock objects are stamped with. A test passes one; everybody else gets the wall clock. */
  now?(): number;
}

export interface ImageInsert {
  /** Files are being dragged over the board, and this is the outline that says so. */
  highlight: boolean;
  /** What to say about the last batch, or `null` when there is nothing to say. */
  message: string | null;
  /** Stop saying it - the toast's close button, and nothing else needs to. */
  dismissMessage(): void;
  onDragEnter(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
  onDragLeave(event: DragEvent): void;
  onDrop(event: DragEvent): void;
  onPaste(event: ClipboardEvent): void;
  /** The Image tool: open the file picker. Returns to Select by itself, because it never left. */
  openPicker(): void;
  /** Upload progress by object id, `0` to `1`. Only this person's uploads; never in the document. */
  progress: ReadonlyMap<string, number>;
  /** Send this object's file again. `false` when this browser no longer has the file. */
  retry(id: string): boolean;
  /** Whether Retry has anything to re-send. */
  canRetry(id: string): boolean;
}

/**
 * A batch that got this far: a file, the shape it turned out to have, and the object it became.
 *
 * `object` is filled in only after the placeholders exist, which is why the type has to name the
 * in-between state - there is a moment when the decode is done and the write is not, and a step that
 * cannot say what it is holding is a step that has to be careful about the order instead.
 */
interface Decoded {
  file: File;
  naturalWidth: number;
  naturalHeight: number;
}

export function useImageInsert(options: ImageInsertOptions): ImageInsert {
  const { doc, boardId, camera, connection, identityId, viewport, undo, onAdded } = options;

  const [highlight, setHighlight] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());

  // The bytes Retry needs, the transfers that are still going, and the drag that has not landed yet. All
  // three are refs rather than state: none of them is ever *shown*, and a render would not make any of them
  // more true. `progress` is the exception, and the only reason is that a bar has to be drawn.
  const filesRef = useRef(new Map<string, File>());
  const uploadsRef = useRef(new Map<string, ReturnType<typeof uploadImage>>());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read from refs inside callbacks that outlive the render that made them.
  const liveRef = useRef({ doc, boardId, camera, connection, identityId, viewport, undo, onAdded, now: options.now });
  useEffect(() => {
    liveRef.current = { doc, boardId, camera, connection, identityId, viewport, undo, onAdded, now: options.now };
  });

  const say = useCallback((texts: readonly string[]): void => {
    const text = [...new Set(texts)].join('\n');
    if (text === '') {
      return;
    }
    setMessage(text);
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setMessage(null);
    }, TOAST_MS);
  }, []);

  const dismissMessage = useCallback((): void => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setMessage(null);
  }, []);

  // The same map the state holds, for the progress callbacks that were made before the render that will
  // draw them: each one has to start from whatever the others have already written.
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  });

  const changeProgress = useCallback((id: string, fraction: number | null): void => {
    // A new Map every time, because a Map that was mutated in place is the same Map it was before, and
    // React would be right to skip the render.
    const next = new Map(progressRef.current);
    if (fraction === null) {
      next.delete(id);
    } else {
      next.set(id, fraction);
    }
    progressRef.current = next;
    setProgress(next);
  }, []);

  /**
   * Send one object's file, and write down whatever comes back.
   *
   * The two writes at the end of this function are the only way an image on this board becomes a picture:
   * `markImageReady` with the key the server named, or `markImageFailed`. Both are origin-untracked in the
   * model, and both refuse to overwrite something that has already been settled - so this function can be
   * called twice for the same object, which is what Retry is, without either call being able to disagree
   * with the other about what the board contains.
   */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const live = liveRef.current;
      if (live.boardId === undefined) {
        // A board with no address: nothing to post to, and the object says so by not becoming a picture.
        markImageFailed(doc, id);
        changeProgress(id, null);
        return;
      }
      const upload = uploadImage(live.boardId, file, (fraction) => {
        changeProgress(id, fraction);
      });
      uploadsRef.current.set(id, upload);
      void upload.promise.then((result: UploadResult) => {
        if (uploadsRef.current.get(id) === upload) {
          uploadsRef.current.delete(id);
        }
        changeProgress(id, null);
        if (result.ok) {
          markImageReady(doc, id, result.assetKey);
          return;
        }
        markImageFailed(doc, id);
        // Two of the ways a transfer can end are not accidents: the room measured the file, or looked at
        // it, and said no. That reason is worth saying out loud - it is the same sentence the board says
        // about a file it refused before sending, and a person who was told their file was fine before it
        // left should hear the same thing when it comes back. A failure that arrived with no reason at all
        // is left to the object itself to describe.
        if (result.reason === 'rejected_by_server') {
          if (result.status === 413) {
            say([REJECTION_MESSAGES.size]);
          } else if (result.status === 415) {
            say([REJECTION_MESSAGES.type]);
          }
        }
      });
    },
    [changeProgress, doc],
  );

  /**
   * Turn accepted files into board objects, then into uploads.
   *
   * Nothing here waits for an upload: the objects are written first and the uploads are started from them,
   * which is what lets everybody - including the person who dropped the files - see the board's shape
   * before the bytes have arrived.
   */
  const addFiles = useCallback(
    (files: readonly File[], placement: Placement): void => {
      const live = liveRef.current;
      if (!isConnected(live.connection)) {
        say([REJECTION_MESSAGES.offline]);
        return;
      }

      const { accepted, rejections } = validateFiles(files);
      const texts = [...rejections].map((rejection: FileRejection) => REJECTION_MESSAGES[rejection]);
      if (accepted.length === 0) {
        say(texts);
        return;
      }

      // The decodes come first, and the reason is undo: the batch has to be one transaction, and a
      // transaction cannot be opened around an `await` - the document would be left open across whatever
      // else happens in between, including somebody else's edits. So every file is decoded, and only then
      // is the document written once.
      void Promise.all(
        accepted.map(async (file): Promise<Decoded | null> => {
          const size = await naturalSizeOf(file);
          return size === null ? null : { file, naturalWidth: size.width, naturalHeight: size.height };
        }),
      ).then((decoded) => {
        const good = decoded.filter((entry): entry is Decoded => entry !== null);
        if (good.length !== accepted.length) {
          // A file the browser could not turn into a picture. The type message is the right thing to say:
          // `File.type` is a claim about a file, and the decode is the test of it. A file that fails here
          // is exactly a file whose name said one thing and whose bytes said another, which is what that
          // message exists for.
          texts.push(REJECTION_MESSAGES.type);
        }
        say(texts);
        if (good.length === 0) {
          return;
        }

        const sizes = good.map((entry) => placementSize(entry.naturalWidth, entry.naturalHeight));
        const rects = layoutRow(sizes, placement.point, placement.anchor);
        // `started` is kept alongside the items, and in the same order, because the ids come back in the
        // order the *items* went in and an upload has to be given the file its object was made from. An
        // item this board would not write is left out of both lists, so the two never fall out of step.
        const items: ImagePlacement[] = [];
        const started: Decoded[] = [];
        for (const [index, entry] of good.entries()) {
          const rect = rects[index];
          if (rect === undefined) {
            continue;
          }
          items.push({
            rect,
            naturalWidth: entry.naturalWidth,
            naturalHeight: entry.naturalHeight,
            contentType: entry.file.type,
          });
          started.push(entry);
        }

        live.undo?.boundary();
        const ids = createImagePlaceholders(
          doc,
          items,
          live.identityId,
          live.now === undefined ? Date.now() : live.now(),
        );
        live.undo?.boundary();
        if (ids.length === 0) {
          return;
        }
        live.onAdded?.(ids);

        ids.forEach((id, index) => {
          const entry = started[index];
          if (entry === undefined) {
            return;
          }
          // The file is kept before the upload starts, so that an upload which fails in the first
          // millisecond - the network being down, the tab being closed - still leaves something Retry
          // could re-send if the person asks it to, later, after a reload that took the file away.
          filesRef.current.set(id, entry.file);
          changeProgress(id, 0);
          startUpload(id, entry.file);
        });
      });
    },
    [changeProgress, doc, say, startUpload],
  );

  const onDragEnter = useCallback((event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) {
      return;
    }
    setHighlight(true);
  }, []);

  const highlightRef = useRef(highlight);
  useEffect(() => {
    highlightRef.current = highlight;
  });

  const onDragOver = useCallback((event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) {
      return;
    }
    if (!highlightRef.current) {
      setHighlight(true);
    }
    // The drop is wanted here, and saying so is what stops the browser from doing what it would
    // otherwise do with a file dropped on a page, which is to open it.
    event.preventDefault();
  }, []);

  /**
   * The outline goes away. Deciding *when* the drag has left the board is not this function's job and
   * cannot be: a drag that crosses from the board area onto a note fires a leave for the board and an enter
   * for the note, and an outline that believed every leave event would flicker over its own contents. The
   * board area - the one thing that knows which element the drag has gone to - decides, and calls this only
   * when the files have really gone.
   */
  const onDragLeave = useCallback((): void => {
    setHighlight(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent): void => {
      setHighlight(false);
      if (!carriesFiles(event.dataTransfer)) {
        // A drop of anything else - selected text, a link - is not this board's business, and is left
        // exactly as it was found.
        return;
      }
      event.preventDefault();
      const files = filesOf(event.dataTransfer);
      if (files.length === 0) {
        return;
      }
      // The top-left of the batch goes where the pointer was: a drop is a statement about a place, and
      // centring a dropped picture on the pointer would put it somewhere the person was not pointing.
      addFiles(files, { anchor: 'top-left', point: worldPointOf(event, liveRef.current.camera) });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent): void => {
      if (isTextEntry(event.target)) {
        // A caret is somewhere, and it gets the paste. This is the whole reason the listener is careful
        // about where it was listening: a board that added an image every time somebody pasted a URL into
        // a note would be a board that could not be typed into.
        return;
      }
      const files = filesOf(event.clipboardData ?? null);
      if (files.length === 0) {
        return;
      }
      // Only now is the event taken, and only from a clipboard that held pictures: text pastes, file
      // drags from another application's list, and everything else a clipboard can carry are left to
      // whatever would normally answer them.
      event.preventDefault();
      // A paste has no place of its own - the pointer's position is not in the event, and the caret the
      // person was thinking with belongs to text that is not here. So it goes in the middle of what they
      // can see, which is at least a place they chose by looking at it.
      const view = liveRef.current.viewport;
      addFiles(files, {
        anchor: 'centre',
        point: screenToWorld(liveRef.current.camera, { x: view.width / 2, y: view.height / 2 }),
      });
    },
    [addFiles],
  );

  const openPicker = useCallback((): void => {
    const live = liveRef.current;
    if (!isConnected(live.connection)) {
      say([REJECTION_MESSAGES.offline]);
      return;
    }
    const input = pickerInput();
    input.onchange = (): void => {
      const files = Array.from(input.files ?? []);
      // Back to nothing, so the same file picked twice is two batches rather than no event at all:
      // an input that still holds yesterday's file sees no change when it is chosen again.
      input.value = '';
      if (files.length === 0) {
        return;
      }
      const view = liveRef.current.viewport;
      addFiles(files, {
        anchor: 'centre',
        point: screenToWorld(liveRef.current.camera, { x: view.width / 2, y: view.height / 2 }),
      });
    };
    input.oncancel = (): void => {
      input.value = '';
    };
    input.click();
  }, [addFiles, say]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) {
        return false;
      }
      const live = liveRef.current;
      if (!isConnected(live.connection)) {
        say([REJECTION_MESSAGES.offline]);
        return false;
      }
      // The object goes back to waiting *before* the bytes do, so that everyone else sees the same thing
      // the Retry button does, and the stale clock starts again from now rather than from the first try.
      if (!markImageRetrying(doc, id, live.now === undefined ? Date.now() : live.now())) {
        return false;
      }
      changeProgress(id, 0);
      startUpload(id, file);
      return true;
    },
    [changeProgress, doc, say, startUpload],
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  // Nothing may be left sending when the board goes away: an upload that lands in a document nobody is
  // looking at writes into a document that no longer exists.
  useEffect(
    () => () => {
      for (const upload of uploadsRef.current.values()) {
        upload.abort();
      }
      uploadsRef.current.clear();
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  // The board stopped being connected while files were in flight. The uploads are left alone - a transfer
  // that is already going may well finish, and a board that cancels its own work on a wobble would be a
  // board that never finished anything. What stops is the outline, which is an invitation to drop more.
  useEffect(() => {
    if (!isConnected(connection)) {
      setHighlight(false);
    }
  }, [connection]);

  return {
    highlight,
    message,
    dismissMessage,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
  };
}

/** Whether this drag is carrying files, which is the only kind this board reacts to. */
function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer === null) {
    return false;
  }
  return Array.from(dataTransfer.types).includes('Files');
}

function filesOf(dataTransfer: DataTransfer | null): File[] {
  if (dataTransfer === null) {
    return [];
  }
  return Array.from(dataTransfer.files);
}

/** Whether the paste landed in something that takes text. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/**
 * Where on the board this event happened, in world units.
 *
 * The board area fills the window, and the event's coordinates are the window's; subtracting the element's
 * own box is what makes that true for a board that does not, which includes a component test's `<div>` and
 * anything a later story docks on the side of the screen.
 */
function worldPointOf(event: DragEvent, camera: Camera): Point {
  const target = event.currentTarget;
  const box = target instanceof Element ? target.getBoundingClientRect() : null;
  const left = box === null ? 0 : box.left;
  const top = box === null ? 0 : box.top;
  return screenToWorld(camera, { x: event.clientX - left, y: event.clientY - top });
}

/**
 * The picture's own size in pixels, or `null` if the browser cannot make one.
 *
 * `createImageBitmap` is the decoder every modern browser has and the only one that will read a file's
 * actual pixels without putting it on screen first. Its two answers are the two answers this board needs:
 * a size, or a refusal. A GIF's first frame is what it reports, which is the frame the placeholder shows
 * too, and is the reason a moving image and a still one need no separate handling here.
 *
 * The bitmap is closed as soon as its size has been read: decoding a ten-megabyte photograph allocates a
 * buffer the size of the photograph, and this one is needed for the four fields of one object and nothing
 * else.
 */
async function naturalSizeOf(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      if (!(bitmap.width > 0) || !(bitmap.height > 0) || !Number.isFinite(bitmap.width)) {
        return null;
      }
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/**
 * The file picker, made once and kept.
 *
 * It is not created per click because an `<input type=file>` is the one element whose *value* outlives the
 * interaction that filled it in: keeping one, and emptying it between uses, is what makes the second
 * "add the same file" a batch rather than nothing. It is off-screen rather than `display: none` because a
 * hidden-from-the-browser element is also hidden from the person's keyboard, and this one is a control
 * that ought to be reachable by Tab if the dialog ever needs them.
 */
function pickerInput(): HTMLInputElement {
  const existing = document.querySelector<HTMLInputElement>('input[data-image-picker]');
  if (existing !== null) {
    return existing;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = IMAGE_PICKER_ACCEPT;
  input.dataset.imagePicker = '';
  input.setAttribute('aria-label', 'Add images');
  input.tabIndex = -1;
  input.className = 'image-file-picker';
  document.body.appendChild(input);
  return input;
}

/** The largest number of files one batch may contain, for whoever builds a picker or a test. */
export const MAX_FILES_PER_BATCH = IMAGE_MAX_FILES_PER_ADD;
