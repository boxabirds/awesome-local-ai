// The three ways a picture gets onto the board (story 12): dragged in, pasted in, chosen from
// the file picker.
//
// They are one flow with three doors. Every door hands the same list of files to the same few
// lines, which is why the rules cannot drift apart between them: a file refused when it is
// dragged is refused when it is pasted, twenty files arrive as twenty files whichever door they
// came through, and a board that is not connected refuses to start an upload from any of them.
//
// What happens after the doors is the part worth reading:
//
//   1. `validateFiles` says which files can go and which reasons went wrong, without touching a
//      pixel of any of them;
//   2. each surviving file is decoded to find its natural size - which is the one thing about a
//      picture that cannot be guessed and the one thing the placeholder needs to exist;
//   3. `createImagePlaceholders` writes the whole addition as one transaction, so dropping three
//      images is one Ctrl+Z that removes three, and every connected person sees the boxes at their
//      final size and in their final places within a second;
//   4. the uploads start, and each one ends by writing `ready` or `failed` under an origin the
//      undo manager does not watch.
//
// The uploads are kept in refs rather than state because they are not something React draws: the
// board draws the *statuses* the document holds, and the only upload fact a render needs is how
// far along this browser's own uploads are (`progress`) and whether a retry would achieve
// anything (`canRetry`, which is a question about a file in this browser's memory).
//
// Nothing here throws and nothing here is caught. Every failure an upload can produce is an
// answer in a union, and every failure a person can see is a sentence.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_STATUS_TICK_MS,
  IMAGE_TOAST_MS,
} from '../../shared/config';
import {
  createImagePlaceholders,
  imageSnapshots,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type PlacementSize,
  type PlaceholderItem,
} from '../../shared/objects/image';
import type { Camera, Point, Size } from '../canvas/camera';
import { screenToWorld, viewportCentre } from '../canvas/camera';
import { isTypingTarget } from '../canvas/BoardViewport';
import { canUpload, type ConnectionState } from '../sync/connectBoard';
import { rejectionMessage, imageFilesOf, validateFiles } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';

/** Where a row of pictures is put down: on a point, or around one. */
type Anchor = 'top-left' | 'centre';

/** One file that arrived at one of the doors, with the size it decodes to. */
interface Measured {
  file: File;
  size: PlacementSize | null;
}

/** A placeholder to upload into, and the bytes that will fill it. */
interface Addition {
  item: PlaceholderItem;
  file: File;
}

/** A sentence on its way out again. */
interface Toast {
  id: number;
  message: string;
}

export interface ImageInsertOptions {
  doc: Y.Doc;
  /**
   * Where the bytes go. A board a component test handed over has no address and nowhere to send
   * a picture, so adding is refused there the way an unreachable board refuses it - with the
   * offline sentence, which is the shape of the truth: the board's storage cannot be reached.
   */
  boardId: string | undefined;
  /** The camera, for the one calculation the picker and the paste need: what is in view. */
  camera: Camera;
  /**
   * How big the board area is, in CSS pixels.
   *
   * The design's option list has the camera and not this, but the camera is a top-left corner
   * (`x`, `y` are the world point at the top-left of the board area), so "centred in the visible
   * board area" cannot be worked out from it alone. The board page already measures the area for
   * the same reason - it is what `resetCamera` and the zoom steps are computed against.
   */
  viewport: Size;
  connection: ConnectionState;
  /** This person's identity, stored on the placeholder as the uploader. */
  identityId: string;
  /**
   * Files were chosen through the picker and the board may go back to the Select tool (the PRD's
   * `image.pick`: the tool returns to Select once the choice is made). Called whether or not
   * every chosen file was accepted: the person is done with the picker either way.
   */
  onFilesChosen?(): void;
  /**
   * Opens and closes one undo step, before and after the placeholders are written - the same
   * callback the toolbar's buttons and the transform gesture are given. Given rather than read
   * from the undo context, because this hook runs in the page that *provides* that context, where
   * the context is not yet visible to it.
   */
  onBoundary?(): void;
}

export interface ImageInsertApi {
  /**
   * Files are being dragged over the board, or have left it: the drop highlight.
   *
   * A boolean rather than the drag events, and that is the whole deviation from the design's
   * `onDragEnter/onDragOver/onDragLeave` trio: entering and leaving a board is a count, not a
   * pair of events - a drag crosses a dozen child elements on its way to the surface and every
   * one of them sends a `dragleave` - and the component that owns the board surface and its
   * camera is `BoardViewport`, which already converts every other pointer position it reports
   * into world units. The hook is told whether files are over the board, and what to do with
   * the ones that arrived.
   */
  onFilesDrag(over: boolean): void;
  /** Files were dropped on the board: put them down with their top-left corner at `world`. */
  onFilesDrop(files: File[], world: Point): void;
  /** A paste that may be carrying pictures; left alone when it is not, or when someone is typing. */
  onPaste(event: ClipboardEvent): void;
  /** Open the system file picker. */
  openPicker(): void;
  /** The hidden `<input type=file>` the picker opens. Render it somewhere in the board. */
  fileInput: JSX.Element;
  /** Upload progress of this browser's own uploads, by image id, 0 to 1. */
  progress: ReadonlyMap<string, number>;
  /** Upload the same file again. False when this browser no longer has it. */
  retry(id: string): boolean;
  /** Whether `retry(id)` would have anything to send. */
  canRetry(id: string): boolean;
  /** What the board is saying right now, oldest first. */
  toasts: readonly string[];
  /** Whether files are being dragged over the board. */
  highlight: boolean;
  /**
   * The clock the board renders with. It advances while any picture on the board is still
   * `uploading`, which is what lets an abandoned upload become `unfinished` in front of people
   * who are watching a board that has stopped changing for other reasons.
   */
  now: number;
}

/** A picture's natural size, or null when this browser cannot decode it. */
async function decodeSize(file: File): Promise<PlacementSize | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    // A decoded picture is a lot of memory for a board that only wanted its size.
    if (typeof bitmap.close === 'function') bitmap.close();
    return Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
      ? { width, height }
      : null;
  } catch {
    // A file whose bytes are not a picture this browser can read. It has already been told it
    // is the right type - that check was its `type`, which a file can lie about - so this is
    // the second half of the same answer.
    return null;
  }
}

export function useImageInsert({
  doc,
  boardId,
  camera,
  viewport,
  connection,
  identityId,
  onFilesChosen,
  onBoundary,
}: ImageInsertOptions): ImageInsertApi {
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [highlight, setHighlight] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const boundaryOfBoard = useRef<(() => void) | undefined>(undefined);
  boundaryOfBoard.current = onBoundary;
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** image id → the file it came from, kept only as long as a retry could use it. */
  const files = useRef(new Map<string, File>());
  /** image id → the upload in flight, so unmounting this board can stop it. */
  const handles = useRef(new Map<string, UploadHandle>());
  const timers = useRef(new Set<number>());
  const toastId = useRef(0);
  const alive = useRef(true);

  // The newest values, for the callbacks that outlive the render that made them: an upload that
  // lands half a minute later belongs to a board whose camera, connection and identity have all
  // moved on since, and it must answer to the current ones.
  const latest = useRef({ doc, boardId, camera, viewport, connection, identityId, onFilesChosen });
  latest.current = { doc, boardId, camera, viewport, connection, identityId, onFilesChosen };

  /** The undo step the board's buttons make, if the board has them. */
  const boundary = useCallback((): void => boundaryOfBoard.current?.(), []);

  /** Say something for four seconds. Repeated sayings of one sentence are separate news. */
  const say = useCallback((message: string): void => {
    const id = (toastId.current += 1);
    setToasts((current) => [...current, { id, message }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, IMAGE_TOAST_MS);
    timers.current.add(timer);
  }, []);

  const writeProgress = useCallback((id: string, fraction: number | null): void => {
    setProgress((current) => {
      const next = new Map(current);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  /** Start (or restart) one upload into a placeholder that already exists. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const address = latest.current.boardId;
      // No address, nowhere to send it. `addFiles` refuses the same thing before it creates a
      // single placeholder, so the only way here is a board that lost its address mid-upload.
      if (address === undefined) return;
      files.current.set(id, file);
      writeProgress(id, 0);
      const handle = uploadImage(address, file, (fraction) => {
        if (alive.current) writeProgress(id, fraction);
      });
      handles.current.set(id, handle);
      void handle.promise.then((result) => {
        handles.current.delete(id);
        // A board that stopped watching has already stopped the upload; the placeholder is left
        // exactly as it is - `uploading`, and nobody left to say otherwise - which is what
        // everyone else will call `unfinished` in five minutes.
        if (!alive.current) return;
        writeProgress(id, null);
        if (result.kind === 'ok') {
          // Nothing left to retry, and nothing to keep the bytes of in memory for.
          files.current.delete(id);
          markImageReady(latest.current.doc, id, result.assetKey);
        } else {
          // The file stays. A person who was told "Upload failed" and has the picture still in
          // front of them is owed a Retry that means it.
          markImageFailed(latest.current.doc, id);
        }
      });
    },
    [writeProgress],
  );

  /** The three doors, and the one flow behind them. */
  const addFiles = useCallback(
    (incoming: readonly File[], anchor: Anchor, point: Point): Promise<void> => {
      if (incoming.length === 0) return Promise.resolve();
      // Nowhere to send them: said as the offline sentence, which is the one sentence true of
      // both - the bytes cannot reach the board.
      if (latest.current.boardId === undefined) {
        say(rejectionMessage('offline'));
        return Promise.resolve();
      }
      // Offline first, before anything is measured or written: a picture that cannot be sent has
      // no business becoming a box on everybody's board first.
      if (!canUpload(latest.current.connection)) {
        say(rejectionMessage('offline'));
        return Promise.resolve();
      }
      const { accepted, rejections } = validateFiles(incoming);
      for (const rejection of rejections) say(rejectionMessage(rejection));
      if (accepted.length === 0) return Promise.resolve();

      return Promise.all(
        accepted.map(async (file): Promise<Measured> => ({ file, size: await decodeSize(file) })),
      ).then((measured) => {
        if (!alive.current) return;
        const undecodable = measured.filter((entry) => entry.size === null).length;
        if (undecodable > 0) {
          // The same sentence the type check says, because it is the same fact as far as anybody
          // is concerned: this file is not a picture we can use.
          say(rejectionMessage('type'));
        }
        const usable = measured.filter(
          (entry): entry is Measured & { size: PlacementSize } => entry.size !== null,
        );
        if (usable.length === 0) return;

        const sizes = usable.map((entry) => placementSize(entry.size.width, entry.size.height));
        const rects = layoutRow(sizes, point, anchor);
        const additions: Addition[] = usable.map((entry, index) => ({
          file: entry.file,
          item: {
            rect: rects[index],
            naturalWidth: entry.size.width,
            naturalHeight: entry.size.height,
            contentType: entry.file.type,
          },
        }));

        // One undo step for the whole addition, and the step boundaries are the board's, not the
        // document's: whatever else was undone and redone before this drop stays as it was.
        boundary();
        const ids = createImagePlaceholders(
          latest.current.doc,
          additions.map((addition) => addition.item),
          latest.current.identityId,
          Date.now(),
        );
        boundary();
        ids.forEach((id, index) => startUpload(id, additions[index].file));
      });
    },
    [say, startUpload, boundary],
  );

  /** The middle of the board area, in world units: where a paste or a pick lands. */
  const centre = useCallback(
    (): Point => screenToWorld(camera, viewportCentre(viewport)),
    [camera, viewport],
  );

  const onFilesDrop = useCallback(
    (dropped: File[], world: Point): void => {
      void addFiles(dropped, 'top-left', world);
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent): void => {
      // Somebody typing takes the paste. The test is what the target of the event is, not what
      // the board thinks is selected: a note's editor, a text object's, a shape's label, a pen
      // field and any input on the board all answer to it, and a picture pasted into one of them
      // would be a picture stolen from the clipboard.
      if (isTypingTarget(event.target)) return;
      const pasted = imageFilesOf(event.clipboardData);
      if (pasted.length === 0) return;
      // The browser's own answer to a paste - inserting the file into the page, or opening it -
      // is not an answer anybody wanted now that the board has taken it.
      event.preventDefault();
      void addFiles(pasted, 'centre', centre());
    },
    [addFiles, centre],
  );

  const openPicker = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  /**
   * The highlight is switched on by a drag that carries files and off by the drag that leaves.
   * Setting it to what it already is renders nothing, which is what makes a `dragover` event -
   * one every few frames of a drag - free.
   */
  const onFilesDrag = useCallback((over: boolean): void => {
    setHighlight(over);
  }, []);

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (file === undefined) return false;
      if (!canUpload(latest.current.connection)) {
        say(rejectionMessage('offline'));
        return false;
      }
      // Back to `uploading` before the upload starts, so the box says what is true while it is
      // going. A placeholder that has been deleted in the meantime is not resurrected.
      if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [say, startUpload],
  );

  /**
   * Whether a Retry would achieve anything: the file is still in this browser's memory and no
   * upload of it is in flight. Both maps are read at the moment of the question, and every change
   * to them is a document write in the same breath, which is what makes a board ask again.
   */
  const canRetry = useCallback(
    (id: string): boolean => files.current.has(id) && !handles.current.has(id),
    [],
  );

  // The clock. Only while a picture on this board is still called `uploading` - which includes
  // somebody else's, since that is the one that goes stale on its own - and stopped otherwise,
  // so a board at rest renders no more than it did before pictures were added to it.
  const uploading = imageSnapshots(doc).some((image) => image.status === 'uploading');
  useEffect(() => {
    if (!uploading) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), IMAGE_STATUS_TICK_MS);
    return () => window.clearInterval(tick);
  }, [uploading]);

  // Stop every upload and every timer when this board goes away. The document keeps whatever the
  // uploads had already written and the connection carries it out, which is why a picture whose
  // upload finished before a reload is still on the board afterwards.
  useEffect(() => {
    alive.current = true;
    const stoppedHandles = handles.current;
    const stoppedTimers = timers.current;
    return () => {
      alive.current = false;
      for (const handle of stoppedHandles.values()) handle.abort();
      stoppedHandles.clear();
      for (const timer of stoppedTimers) window.clearTimeout(timer);
      stoppedTimers.clear();
    };
  }, []);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      className="image-file-input"
      data-testid="image-file-input"
      accept={IMAGE_ACCEPTED_TYPES.join(',')}
      multiple
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const chosen = Array.from(event.currentTarget.files ?? []);
        // Cleared before anything else looks at it: choosing the same file twice in a row is a
        // second choice, and a value left behind would be the same value and no event.
        event.currentTarget.value = '';
        void addFiles(chosen, 'centre', centre()).finally(() => {
          if (alive.current) latest.current.onFilesChosen?.();
        });
      }}
    />
  );

  return {
    onFilesDrag,
    onFilesDrop,
    onPaste,
    openPicker,
    fileInput,
    progress,
    retry,
    canRetry,
    toasts: toasts.map((toast) => toast.message),
    highlight,
    now,
  };
}

/**
 * What `BoardViewport` calls when files come over the board: true on the way in, false when the
 * drag leaves or drops. The counting is the surface's business (see `onFilesDrag` above).
 */
export type FilesDragListener = (over: boolean) => void;
