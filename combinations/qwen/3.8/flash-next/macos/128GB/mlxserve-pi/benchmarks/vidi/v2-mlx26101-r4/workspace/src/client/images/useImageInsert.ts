/**
 * Adding images to the board, from the three places a person can add them (story 12).
 *
 * This hook is the whole of the flow: a drag ends, a paste happens, or a file picker closes. All three are the
 * same sequence and are written once —
 *
 *   are we connected? → which files will the board take? → how big is each picture? → put the placeholders on
 *   the board in one step → upload them all at once → write each result into the document as it arrives
 *
 * — and the order is not interchangeable. The connection is asked about first because an image that is added
 * while the board is unreachable is an image that nobody else will ever be told about, and a placeholder that is
 * created in that state sits at its full size on the board of somebody who cannot receive it. The files are
 * filtered before any of them is decoded, because decoding forty files from a folder to throw thirty-nine away is
 * work the person never asked for. And the placeholders are created *before* the uploads start, which is the
 * entire reason a slow upload is visible to anybody but the person who started it.
 *
 * What lives where, because a hook that keeps its state in the wrong place is a hook that loses it:
 *
 *  - the **document** holds the image and its status — every person on the board sees all of it;
 *  - **React state** holds what the screen is drawn from: the drag highlight, and the progress map;
 *  - **refs** hold what must outlive a render but is never drawn: the `File` behind each image (for Retry), and
 *    the upload handles (so they can be aborted).
 *
 * The files in those refs are the reason Retry is only as good as this tab's memory. The browser gives nobody a
 * copy of a dropped file later, so a page that is reloaded has an image in `failed` with nothing to upload —
 * which is why the failed state says what happened, and why the Remove button is always there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type * as Y from 'yjs';

import type { AcceptedImageType } from '../../shared/config';
import { isAcceptedImageType } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { deleteObjects } from '../../shared/board-model';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  layoutRow,
  type ImageItem,
  type Size,
} from '../../shared/objects/image';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { isTypingTarget } from '../board/useBoardKeys';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';
import { pushToast } from '../ui/Toast';

/**
 * The shape of the events this hook answers.
 *
 * It is written as a shape rather than as `DragEvent` or `ClipboardEvent` because the board is handed both
 * kinds: React's synthetic events carry the files on `dataTransfer`, and the browser's own `ClipboardEvent`
 * carries them on `clipboardData`. A handler that demanded one of the two classes would have to be given the
 * other through a cast; a handler that asks for the four fields it actually reads can be handed either, and says
 * so in its own type.
 */
export interface FilesEvent {
  readonly dataTransfer?: DataTransfer | null;
  readonly clipboardData?: DataTransfer | null;
  readonly target?: EventTarget | null;
  readonly currentTarget?: EventTarget | null;
  readonly relatedTarget?: EventTarget | null;
  readonly clientX?: number;
  readonly clientY?: number;
  preventDefault?(): void;
  stopPropagation?(): void;
}

export interface ImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** The camera, for turning the point a file was dropped at into a place on the board. */
  camera: Camera;
  /** The size of the board's surface, in screen pixels. Where a paste is centred. */
  viewport: Size;
  /** Whether the board is reachable. Nothing is added without it; see `isOnline`. */
  connection: ConnectionState;
  /** `String(doc.clientID)`: whose tab this is, written into every image this tab uploads. */
  identityId: string;
  /**
   * The file input the picker opens.
   *
   * The design has this hook create its own input; the board renders it instead, and that is the better half of
   * the trade: a node in the page is a node a test can be pointed at, a node React owns is a node that is
   * definitely gone when the board is unmounted, and nothing about what the person sees is different.
   */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Say where a step begins and ends. The same boundary the rest of the board's gestures use. */
  boundary?(): void;
  /**
   * The board's objects, as this render sees them.
   *
   * Used for one thing: noticing when an image this tab was uploading is no longer on the board, so the upload
   * stops and the file behind it is let go. Without it, a person who removes an image mid-upload keeps paying for
   * the upload of a picture that is not there any more.
   */
  objects?: readonly ObjectSnapshot[];
  /** Called after the picker has been answered, or given up on: the tool goes back to Select. */
  onSettled?(): void;
}

export interface ImageInsert {
  /** Files are being dragged over the board, so the outline is drawn. */
  readonly dropping: boolean;
  /** How far each upload has got, by image id, 0 to 1. Only ever for *this* tab's uploads. */
  readonly progress: ReadonlyMap<string, number>;
  onDragEnter(event: FilesEvent): void;
  onDragOver(event: FilesEvent): void;
  onDragLeave(event: FilesEvent): void;
  onDrop(event: FilesEvent): void;
  onPaste(event: FilesEvent): void;
  /** Open the system's file picker. Refused, with a toast, while the board is not reachable. */
  openPicker(): void;
  /** What the hidden input's `change` does. */
  onPicked(event: FilesEvent): void;
  /** Upload the file this image came from again. False when this tab is not holding that file. */
  retry(id: string): boolean;
  /** Whether Retry would do anything. */
  canRetry(id: string): boolean;
  /** Take an image off the board. The upload stops, and the file is let go. */
  remove(id: string): void;
}

/**
 * Whether images can be added right now.
 *
 * `connected` means the socket is open; `confirmed` means it is open *and* the board has caught up with what is
 * stored. Both are fine. `connecting`, `reconnecting` and `load_failed` are not: a placeholder written while the
 * board is not connected goes into the local document and reaches nobody, and the worst version of that is the
 * silent one — an image on my screen that is on nobody else's, with nothing on it to say when it stopped being
 * shared.
 */
export function isOnline(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

/** The refusals, in the order they are said: what it is, how big it is, how many there are. */
const REJECTION_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

/** The files in an event, or none. A drag of the board's own objects has no files in it. */
export function filesOf(event: FilesEvent): File[] {
  const transfer = event.dataTransfer ?? event.clipboardData ?? null;
  const files = transfer?.files;
  if (files === undefined || files === null) return [];
  // A `FileList` is a live object owned by the event; the board keeps an array, because by the time a decode
  // has finished the event is long gone and the list may be empty.
  return Array.from(files);
}

/**
 * Whether this drag is carrying files.
 *
 * `types` rather than `files`, because `items` and `files` are empty during a drag by design — a drag that has
 * not landed yet is not allowed to hand over its contents. `Files` in the type list is the only honest way to ask,
 * and it is how a drag of a selected note is told apart from a drag of a screenshot.
 */
export function dragCarriesFiles(event: FilesEvent): boolean {
  const types = event.dataTransfer?.types;
  if (types === undefined || types === null) return false;
  return Array.from(types).includes('Files');
}

/** A size the board can draw a box for. */
function usableSize(size: Size | null): size is Size {
  return (
    size !== null &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * What a picture is, in pixels, as told by the only thing that can say: the browser's own decoder.
 *
 * `null` for a file that does not decode — a PDF with a `.png` name that got past the type check, a WebP that
 * was truncated on the way to the clipboard, a zero-byte file. That is reported as the type message rather than a
 * "decode failed" message, because from where the person is standing those are the same fact: this file is not a
 * picture the board can draw. There is no second way to measure a picture, and none is invented here: a guess
 * about dimensions becomes an image placed at the wrong size that nobody can fix.
 */
export async function naturalSize(file: File): Promise<Size | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const size = { width: bitmap.width, height: bitmap.height };
  // An `ImageBitmap` holds the decoded pixels, which for a large photo is more memory than the board has any
  // business holding on to. The dimensions are all this board keeps.
  if (typeof bitmap.close === 'function') bitmap.close();
  return usableSize(size) ? size : null;
}

/** The type to write into the document, from a file the type check has already passed. */
function acceptedType(file: File): AcceptedImageType | null {
  return isAcceptedImageType(file.type) ? file.type : null;
}

/** A point, relative to the surface an event landed on — screen pixels, which is what a camera is given. */
function surfacePoint(event: FilesEvent): Point {
  const target = (event.currentTarget ?? event.target) as HTMLElement | null;
  const rect = typeof target?.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null;
  return { x: (event.clientX ?? 0) - (rect?.left ?? 0), y: (event.clientY ?? 0) - (rect?.top ?? 0) };
}

/** The middle of what is on screen, in board coordinates. */
export function viewCentre(camera: Camera, viewport: Size): Point {
  return screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
}

/**
 * One upload, from start to whatever it turned into.
 *
 * `attempt` is how a result is thrown away. A retry of an image that is still uploading, or a Remove while the
 * bytes are in the air, abandons an upload whose answer is no longer about anything — and an abandoned upload
 * that writes its result would put a picture back on a board that has been told it is gone, or mark a new attempt
 * failed on the strength of an old one. So every upload is handed a token, and the only token that gets to write
 * is the one still in the map when the answer comes back.
 */
interface Attempt {
  id: string;
  aborted: boolean;
}

export function useImageInsert({
  doc,
  boardId,
  camera,
  viewport,
  connection,
  identityId,
  inputRef,
  boundary,
  objects,
  onSettled,
}: ImageInsertArgs): ImageInsert {
  const [dropping, setDropping] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());

  /** The file each of this tab's images came from, for Retry. Gone on reload, which is by design. */
  const files = useRef(new Map<string, File>());
  /** The uploads in flight, by image id. */
  const handles = useRef(new Map<string, UploadHandle>());
  /** The upload that is still the current one for its image, by image id. */
  const attempts = useRef(new Map<string, Attempt>());

  /**
   * The things a callback reads, as they are *now*.
   *
   * Every handler here is stable — created once, never remade — and that is only possible because none of them
   * reads the camera, the connection or the document out of the render they were made in. The camera moves every
   * frame while the board is panned, and a drop handler remade on every frame is a handler that is thrown away
   * between the moment it was asked for and the moment it is used, which is exactly when a drop happens.
   */
  const live = useRef({ doc, boardId, camera, viewport, connection, identityId, boundary, onSettled });
  live.current = { doc, boardId, camera, viewport, connection, identityId, boundary, onSettled };

  const setFraction = useCallback((id: string, fraction: number | null): void => {
    setProgress((current) => {
      if (fraction === null) {
        if (!current.has(id)) return current;
        const done = new Map(current);
        done.delete(id);
        return done;
      }
      // A number that has not moved does not need a new map, and therefore does not need a render: an upload
      // reports progress faster than a screen draws it.
      if (current.get(id) === fraction) return current;
      return new Map(current).set(id, fraction);
    });
  }, []);

  /** Start an upload for an image that is already on the board. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const now = live.current;
      const attempt: Attempt = { id, aborted: false };
      attempts.current.set(id, attempt);

      setFraction(id, 0);
      const handle = uploadImage(now.boardId, file, (fraction) => {
        // A progress report for an abandoned attempt is a report about an upload nobody is waiting for; it would
        // also overwrite the fresh zero of a retry that has just started.
        if (attempt.aborted) return;
        setFraction(id, fraction);
      });
      handles.current.set(id, handle);

      void handle.promise.then((result) => {
        if (handles.current.get(id) === handle) handles.current.delete(id);
        if (attempt.aborted) return;
        attempts.current.delete(id);
        setFraction(id, null);
        if (result.kind === 'ok') markImageReady(live.current.doc, id, result.assetKey);
        else {
          markImageFailed(live.current.doc, id);
          // The status in the document is what the person sees; the status on the wire is what the reason is. A
          // 415 and a network that died look the same on the board, and are entirely different in a log.
          console.error(`image upload failed for ${id}: ${result.status === undefined ? 'no answer' : result.status}`);
        }
      });
    },
    [setFraction],
  );

  /**
   * Put the images on the board and start their uploads.
   *
   * Returns the ids it created, in the order the files came in.
   */
  const addFiles = useCallback(
    async (incoming: readonly File[], at: Point, anchor: 'top-left' | 'centre'): Promise<string[]> => {
      const now = live.current;

      // 1. Is the board reachable? Before anything else, and before anything is created.
      if (!isOnline(now.connection)) {
        pushToast(REJECTION_MESSAGES.offline);
        return [];
      }

      // 2. Which of these files does the board take? Every refusal is said, once each.
      const { accepted, rejections } = validateFiles(incoming);
      for (const kind of REJECTION_ORDER) {
        if (rejections.has(kind)) pushToast(REJECTION_MESSAGES[kind]);
      }
      if (accepted.length === 0) return [];

      // 3. How big is each picture? A file that will not decode is refused as the wrong type, and the rest go
      //    on without it.
      const items: ImageItem[] = [];
      const chosen: File[] = [];
      let undecodable = false;
      for (const file of accepted) {
        const type = acceptedType(file);
        const natural = type === null ? null : await naturalSize(file);
        const size = natural === null ? null : placementSize(natural.width, natural.height);
        if (type === null || natural === null || !usableSize(size)) {
          undecodable = true;
          continue;
        }
        items.push({ rect: { x: 0, y: 0, width: size.width, height: size.height }, naturalWidth: natural.width, naturalHeight: natural.height, contentType: type });
        chosen.push(file);
      }
      if (undecodable) pushToast(REJECTION_MESSAGES.type);
      if (items.length === 0) return [];

      // 4. Where do they go? A row, tops in a line, starting where the files were dropped — or centred, when the
      //    clipboard had no position to go by.
      const rects = layoutRow(
        items.map((item) => ({ width: item.rect.width, height: item.rect.height })),
        at,
        anchor,
      );
      const placed: ImageItem[] = [];
      const usable: File[] = [];
      items.forEach((item, index) => {
        const rect = rects[index];
        if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || rect.width <= 0 || rect.height <= 0) return;
        placed.push({ ...item, rect });
        usable.push(chosen[index]);
      });
      if (placed.length === 0) return [];

      // 5. One step, one transaction: everybody on the board sees all of them arrive at once, and one undo takes
      //    all of them away.
      now.boundary?.();
      const created = createImagePlaceholders(live.current.doc, placed, live.current.identityId, Date.now());
      now.boundary?.();
      if (created.length !== usable.length) {
        // The model refused to create something it was handed. That should not be possible — every rect and every
        // dimension above was checked — but an image that exists on the board with no upload behind it would show
        // "Uploading…" for five minutes and then "didn't finish", so it is closed off here rather than hoped for.
        for (const id of created.slice(usable.length)) markImageFailed(live.current.doc, id);
      }

      // 6. All of them, at once. The board does not wait for one picture to finish before starting the next.
      created.forEach((id, index) => {
        const file = usable[index];
        if (file === undefined) return;
        files.current.set(id, file);
        startUpload(id, file);
      });
      return created;
    },
    [startUpload],
  );

  // A drop. The point the files were released at is where the first one lands: a person who drops a file next to
  // a note they are arranging means *there*, and a board that put it in the middle of the screen would be
  // answering a question that was not asked.
  const onDrop = useCallback(
    (event: FilesEvent): void => {
      const files = filesOf(event);
      if (files.length === 0) return;
      event.preventDefault?.();
      setDropping(false);
      const now = live.current;
      void addFiles(files, screenToWorld(now.camera, surfacePoint(event)), 'top-left');
    },
    [addFiles],
  );

  // A paste. Left alone — entirely — while a text field has the caret: pasting into a note, a text object, a
  // label or an input is that field's business, and the board does not get to decide that a screenshot was meant
  // for it. The check is on the event's target rather than on the document's active element because the two
  // disagree in a browser that has just moved focus, and the event knows where it started.
  const onPaste = useCallback(
    (event: FilesEvent): void => {
      if (isTypingTarget(event.target ?? null)) return;
      const pasted = filesOf(event);
      // A paste of text is not the board's either: it goes on to whatever the browser would have done with it.
      if (pasted.length === 0) return;
      event.preventDefault?.();
      const now = live.current;
      void addFiles(pasted, viewCentre(now.camera, now.viewport), 'centre');
    },
    [addFiles],
  );

  const onDragEnter = useCallback((event: FilesEvent): void => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    setDropping(true);
  }, []);

  const onDragOver = useCallback((event: FilesEvent): void => {
    // The answer to a `dragover` is what tells the browser this is a place files may be released, and what the
    // cursor is allowed to say about it. Without it there is no drop event at all, only a cursor that shrugs.
    if (!dragCarriesFiles(event)) return;
    event.preventDefault?.();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  }, []);

  // A leave that crosses into the board's own children is not a leave. `dragleave` fires every time the drag
  // moves from the surface onto one of the things inside it — onto a note, onto the outline itself — and a board
  // that answered each one would flicker its highlight off and on while a file was still in the air.
  const onDragLeave = useCallback((event: FilesEvent): void => {
    const surface = event.currentTarget as HTMLElement | null;
    const goingTo = event.relatedTarget as Node | null;
    if (surface !== null && goingTo !== null && typeof surface.contains === 'function' && surface.contains(goingTo)) {
      return;
    }
    setDropping(false);
  }, []);

  const openPicker = useCallback((): void => {
    if (!isOnline(live.current.connection)) {
      pushToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = inputRef.current;
    if (input === null) return;
    // The picker is opened from a click or a key press, which is the only way a browser lets it be opened, and
    // it must be opened before anything is awaited: a picker opened after an `await` has lost the gesture that
    // asked for it and does not appear.
    input.value = '';
    input.click();
  }, [inputRef]);

  const onPicked = useCallback(
    (event: FilesEvent): void => {
      const input = inputRef.current;
      const picked = input === null ? filesOf(event) : Array.from(input.files ?? []);
      // The value is cleared before anything is awaited so that choosing the same file twice in a row is two
      // picks and not no pick: an input whose value already matches what was chosen does not fire a change.
      if (input !== null) input.value = '';
      // Whether the person chose files or closed the window, the tool goes back to Select. A board left holding
      // an armed tool after a cancelled picker is a board still waiting for something.
      live.current.onSettled?.();
      if (picked.length === 0) return;
      const now = live.current;
      void addFiles(picked, viewCentre(now.camera, now.viewport), 'centre');
    },
    [addFiles, inputRef],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (file === undefined) return false;
      if (handles.current.has(id)) return false;
      // Back to uploading, in the document, before the upload starts: everybody else on the board sees the
      // placeholder come back to life, and the clock on the unfinished state starts again from this attempt.
      if (!markImageRetrying(live.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  const canRetry = useCallback((id: string): boolean => files.current.has(id) && !handles.current.has(id), []);

  /**
   * Take an image off the board.
   *
   * It is the board's own delete, so the image goes with whatever else is selected and one undo puts it back. The
   * upload is stopped first and the file let go, because the person has said they do not want this picture, and
   * the only rudeness left is to carry on uploading it and to keep their clipboard file for the rest of the
   * session on the strength of a decision they have already changed.
   */
  const remove = useCallback(
    (id: string): void => {
      const attempt = attempts.current.get(id);
      if (attempt !== undefined) attempt.aborted = true;
      const handle = handles.current.get(id);
      if (handle !== undefined) handle.abort();
      handles.current.delete(id);
      attempts.current.delete(id);
      files.current.delete(id);
      setFraction(id, null);
      live.current.boundary?.();
      deleteObjects(live.current.doc, [id]);
      live.current.boundary?.();
    },
    [setFraction],
  );

  /**
   * Let go of anything the board has stopped having.
   *
   * An image that is no longer on the board has no reason for its upload to carry on, and no reason for this tab
   * to be holding a copy of a file that was just removed. This is the same rule the paragraph above makes, seen
   * from the other side: the person who deletes may do it through the selection bar, the Delete key or a
   * collaborator's undo, and none of those paths know anything about uploads.
   */
  useEffect(() => {
    if (objects === undefined) return;
    const stillThere = new Set(objects.map((object) => object.id));
    for (const [id, handle] of [...handles.current]) {
      if (stillThere.has(id)) continue;
      const attempt = attempts.current.get(id);
      if (attempt !== undefined) attempt.aborted = true;
      handle.abort();
      handles.current.delete(id);
      attempts.current.delete(id);
      files.current.delete(id);
      setFraction(id, null);
    }
  }, [objects, setFraction]);

  // A drag that was abandoned in the air — the files dragged off the window and released somewhere else — leaves
  // no `dragleave` behind it, and a board still showing its drop outline after that is making a promise about a
  // drop that is never coming. So the outline is taken back whenever the board loses the window altogether.
  useEffect(() => {
    if (!dropping) return;
    const clear = (): void => {
      setDropping(false);
    };
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('blur', clear);
    };
  }, [dropping]);

  // The upload handles are the one thing in this hook that outlives a render and holds a live request. When the
  // board is unmounted — the address changed, the page was closed, React's development double-mount — those
  // requests have nothing left to report to.
  useEffect(() => {
    const inFlight = handles.current;
    const held = attempts.current;
    return () => {
      for (const attempt of held.values()) attempt.aborted = true;
      for (const handle of inFlight.values()) handle.abort();
      inFlight.clear();
      held.clear();
    };
  }, []);

  return {
    dropping,
    progress,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    onPicked,
    retry,
    canRetry,
    remove,
  };
}
