// The one place a picture gets onto the board (story 12).
//
// Three doors — a drop, a paste, the Image button — and one path behind them:
//
//   validate → decode for size → placeholders in one transaction → upload each, one at a time
//
// Everything in this file exists to keep that path single. That is why the three handlers are one
// function with three entrances rather than three functions that happen to look similar: a rule added
// later — a fifth media type, a different layout, another undo boundary — has to be written once, and
// the moment it is written in three places the doors start disagreeing about what "add an image" means.
// That is the kind of bug nobody sees until somebody pastes something that a drop would have refused.
//
// Three things about the order, because they are the parts that are not obvious from the code:
//
//   * The placeholders are written *before* any byte is sent, in one LOCAL_ORIGIN transaction. That is
//     what makes them appear in under a second (image.uploading), what leaves something reportable
//     behind when an upload is abandoned (image.upload_stalled), and what puts a fifteen-file drop in
//     the undo history as one step. An upload's answer arrives later, under UPLOAD_ORIGIN, outside that
//     history: undoing "the picture arrived" would undo other people's work along with it.
//   * Nothing is measured before it is checked, and nothing is checked twice. `validateFiles` has
//     already refused the wrong type and the wrong size; the decode here is for pixel dimensions only,
//     because the size of a file on disk says nothing about how big the picture is and the placeholder
//     has to be drawn at its final size.
//   * A file that cannot be decoded never becomes an object at all. The board is not a place where a
//     broken picture can be parked permanently, and this browser is the one machine that can tell
//     (image.decode).
//
// The last thing worth naming is what is *not* shared. The progress map, the files behind a Retry and
// the clock are this tab's, in React state and a ref, and never in the document: forty-one people
// watching one upload would otherwise pay for one person's progress bar. The document carries the
// status, which is the part that has to travel (image.placeholder_other).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type RefObject,
} from 'react';
import type * as Y from 'yjs';
import { IMAGE_INPUT_ACCEPT } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import {
  type Placement,
  type PlacementSize,
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { isEditableTarget } from '../board/typingGuard';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage } from './uploadImage';

/**
 * A drag or paste event, in the few parts this hook touches.
 *
 * Structural rather than `React.DragEvent` because the two doors carry their files in two different
 * places — a drag in `dataTransfer`, a paste in `clipboardData` — and one interface that names both is
 * what lets the three doors share the one path behind them.
 */
export interface DropEventLike {
  readonly dataTransfer?: DataTransfer | null;
  readonly clipboardData?: DataTransfer | null;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly target?: EventTarget | null;
  preventDefault(): void;
}

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  /** The camera, so a drop lands under the pointer and a paste lands in the middle of the view. */
  camera: Camera;
  /** The connection, because an upload that cannot be confirmed should not be started at all. */
  connection: ConnectionState;
  /** This tab's id, stored as the placeholder's `uploaderId` and `createdBy`. */
  identityId: string;
  /** Say a thing at the bottom of the screen. Every refusal in this story is told through this. */
  notify(text: string): void;
  /** Put the tool back where it was: the Image button is one-shot (image.picker). */
  onPickerSettled?(): void;
  /** Close the undo step already open, so a drop is a step of its own. */
  boundary?(): void;
}

export interface ImageInsertApi {
  /** A drag is over the board: the browser is told a drop here is allowed, which is what un-grey's it. */
  onDragOver(event: DropEventLike): void;
  /** Files dropped on the board, at the pointer. */
  onDrop(event: DropEventLike): void;
  /** Files pasted into the page: added at the centre of the view, like the picker's answer. */
  onPaste(event: ReactClipboardEvent<Element> | DropEventLike): void;
  /** The Image button / I. Opens the file picker, or says why it will not. */
  openPicker(): void;
  /** The hidden input's props, so the board can render `<input {...api.inputProps} />`. */
  inputProps: ImageFileInputProps;
  /** Upload progress per object id, for this tab's own uploads only. */
  progress: ReadonlyMap<string, number>;
  /** This tab's progress for one object, in the shape the image controls want. */
  progressOf(id: string): number | undefined;
  /** Send the same file again. False when this tab no longer has it, which is the answer after a reload. */
  retry(id: string): boolean;
  /** Whether `retry(id)` would do anything, so a box can offer Retry or hold it back. */
  canRetry(id: string): boolean;
  /** The object ids whose file this tab is still holding. For tests, and for nobody else. */
  heldFiles(): readonly string[];
  /** The hidden input `openPicker` clicks. The board renders `<input {...api.inputProps} ref={api.inputRef} />`. */
  inputRef: RefObject<HTMLInputElement | null>;
}

export interface ImageFileInputProps {
  type: 'file';
  /** The same list the validator reads, so the picker and the rule cannot drift apart. */
  accept: string;
  multiple: true;
  'data-testid': 'image-file-input';
  tabIndex: -1;
  'aria-hidden': true;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
}

/** A drag event: the two handlers that need a `dataTransfer` to say anything about it. */
export interface DragDropEventLike extends DropEventLike {
  readonly dataTransfer: DataTransfer | null;
}

/** Only these two states mean "an upload could be confirmed right now". */
/**
 * Whether a file dropped on this board should be taken.
 *
 * `connecting` is allowed, and that is the whole point of writing this function out: it is the state a
 * board is in for the first second after a person opens their link, and a picture dropped in that
 * second is a picture they came here to put up. The document keeps whatever is put in it while the
 * socket is still handshaking and sends it when the socket arrives, and an upload that the network
 * refuses says so and offers Retry — so nothing is lost by taking the file. What is not taken is a
 * board that has given up on the document (`load_failed`) or is actively looking for a network it has
 * lost (`reconnecting`): those are the states the toast's "when you reconnect" is true about.
 */
function uploadReady(connection: ConnectionState): boolean {
  return (
    connection === 'connecting' ||
    connection === 'connected' ||
    connection === 'confirmed'
  );
}

/** Does this drag carry files? `types` is the only part of a drag a `dragover` handler may read. */
export function hasFiles(transfer: DataTransfer): boolean {
  const types = transfer.types;
  if (types !== undefined && typeof types.includes === 'function') return types.includes('Files');
  return transfer.files.length > 0;
}

/** The files a drag or a paste carries, copied out so the caller can hold on to them. */
function eventFiles(event: {
  dataTransfer?: DataTransfer | null;
  clipboardData?: DataTransfer | null;
}): File[] {
  // A drop's files are in `dataTransfer`; a paste's are in `clipboardData`, which on a browser that
  // supports pasting a screenshot is the only place they are ever written.
  const transfer = event.dataTransfer ?? event.clipboardData;
  if (!transfer) return [];
  const files: File[] = [];
  for (let index = 0; index < transfer.files.length; index += 1) {
    const file = transfer.files.item(index);
    if (file) files.push(file);
  }
  return files;
}

/** The middle of what the person can see, in world units. */
function viewCentre(camera: Camera): Point {
  // The board is the window, so the screen point in the middle is half a viewport along each way.
  // Only that point is returned: `layoutRow` is what centres a row, and taking half a box away here
  // as well is how a pasted picture ends up half a box away from the middle it was meant to land in.
  return screenToWorld(camera, {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
}

/** Ask the browser how big a file's pixels are. `null` when it says it cannot draw the file. */
async function decodeSize(file: File): Promise<PlacementSize | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    // A bitmap is a block of memory the size of the picture. Forty of them still open because nobody
    // closed them is how a board eats a gigabyte.
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** The three doors, the picker, and the progress and Retry the boxes show. */
export function useImageInsert(args: UseImageInsertArgs): ImageInsertApi {
  const { doc, boardId, camera, connection, identityId, notify, onPickerSettled, boundary } = args;

  /** object id → the file behind it, for a Retry. This tab's, never in the document. */
  const files = useRef(new Map<string, File>());
  /** object id → the request in flight, so an unmount can stop one writing into a dead board. */
  const inFlight = useRef(new Map<string, { abort(): void }>());
  /** Whether this board is still on the page. An upload that answers after that is news to nobody. */
  const alive = useRef(true);

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** The live numbers, so a burst of progress events becomes one render per frame. */
  const fractions = useRef(new Map<string, number>());
  const flushScheduled = useRef(false);

  useEffect(() => {
    alive.current = true;
    const requests = inFlight.current;
    const held = files.current;
    return () => {
      alive.current = false;
      for (const request of requests.values()) request.abort();
      requests.clear();
      // The files go too: after a reload this tab has nothing to re-send, which is exactly why a
      // placeholder that survives a reload says "Image unavailable" rather than offering a Retry
      // nobody can honour (image.upload_failure).
      held.clear();
    };
  }, []);

  /** Publish the progress map, at most once per frame. */
  const publish = useCallback((): void => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? (run: () => void) => requestAnimationFrame(() => run())
        : (run: () => void) => setTimeout(run, 16);
    schedule(() => {
      flushScheduled.current = false;
      if (!alive.current) return;
      setProgress(new Map(fractions.current));
    });
  }, []);

  const setFraction = useCallback(
    (id: string, fraction: number): void => {
      if (fraction < 0) fractions.current.delete(id);
      else fractions.current.set(id, fraction);
      publish();
    },
    [publish],
  );

  /** Say each refusal once, however many files caused it (image.mixed_batch). */
  const reportRejections = useCallback(
    (rejections: ReadonlySet<FileRejection>): void => {
      for (const rejection of rejections) notify(REJECTION_MESSAGES[rejection]);
    },
    [notify],
  );

  /** One file, one request, one answer written into the document. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const handle = uploadImage(boardId, file, (fraction) => setFraction(id, fraction));
      inFlight.current.set(id, handle);
      files.current.set(id, file);
      setFraction(id, 0);
      void handle.promise.then((result) => {
        inFlight.current.delete(id);
        if (!alive.current) return;
        setFraction(id, -1);
        if (result.kind === 'ok') {
          // Outside the undo history on purpose: this is a file arriving, not a person deciding
          // something. Undo must not turn a picture back into a box and take a neighbour's work with it.
          markImageReady(doc, id, result.assetKey);
        } else {
          // No toast. The box itself says "Upload failed" to the person who can do something about it,
          // and "Image unavailable" to everybody else, which is the same fact from their side
          // (image.upload_failure).
          markImageFailed(doc, id);
        }
      });
    },
    [boardId, doc, setFraction],
  );

  /** The path behind all three doors. `at` is where the pointer was, or null for the middle of the view. */
  const addFiles = useCallback(
    async (incoming: readonly File[], at: Point | null): Promise<void> => {
      // The gate is on the path rather than on the doors, because all three of them can be opened while
      // a board is reconnecting: a file can already be in the clipboard, or on its way out of a picker
      // that was opened before the connection went. An upload that cannot be confirmed is not started
      // at all, and nothing is created that would then be disappointed about (image.offline).
      if (!uploadReady(connection)) {
        notify(REJECTION_MESSAGES.offline);
        return;
      }
      const plan = validateFiles(incoming);
      reportRejections(plan.rejections);
      if (plan.accepted.length === 0) return;

      const sizes = await Promise.all(plan.accepted.map(decodeSize));
      const decodable: { file: File; size: PlacementSize }[] = [];
      let undecodable = 0;
      plan.accepted.forEach((file, index) => {
        const size = sizes[index];
        if (size === undefined || size === null) {
          undecodable += 1;
          return;
        }
        decodable.push({ file, size });
      });
      if (undecodable > 0) notify(REJECTION_MESSAGES.type);
      if (decodable.length === 0) return;

      // Files in, boxes out: a row, at the pointer or across the middle of the view, each one already
      // scaled down to at most 800 board units along its longest side (image.place_size).
      const placed = decodable.map((item) => placementSize(item.size.width, item.size.height));
      const anchor: Point = at ?? viewCentre(camera);
      const rects = layoutRow(placed, anchor, at === null ? 'centre' : 'top-left');
      const items: Placement[] = decodable.map((item, index) => ({
        rect: rects[index],
        naturalWidth: item.size.width,
        naturalHeight: item.size.height,
        // The file's own claim about what it is, recorded and then ignored: the Worker reads the type
        // out of the bytes and this field is never a fact about the stored picture (image.types).
        contentType: item.file.type,
      }));

      // One local transaction, so one drop is one undo step and one Cmd+Z after a fifteen-file drop
      // takes the whole drop away and leaves whatever was there before it alone.
      boundary?.();
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());
      if (ids.length === 0) return;

      ids.forEach((id, index) => {
        const entry = decodable[index];
        // The file is remembered before the request goes out, so the box already has something to Retry
        // with if the first attempt dies on the way.
        files.current.set(id, entry.file);
        startUpload(id, entry.file);
      });
    },
    [camera, connection, doc, identityId, notify, reportRejections, startUpload],
  );

  const onDrop = useCallback(
    (event: DragDropEventLike): void => {
      const dropped = eventFiles(event);
      if (dropped.length === 0) return; // a link, or some text, dragged from somewhere else
      event.preventDefault();
      // Screen → world while the event is still here: the camera may be panned or zoomed by the time
      // the files have been read, and the pointer is the only thing that knows where the person aimed.
      const x = Number.isFinite(event.clientX ?? 0) ? (event.clientX as number) : 0;
      const y = Number.isFinite(event.clientY ?? 0) ? (event.clientY as number) : 0;
      void addFiles(dropped, screenToWorld(camera, { x, y }));
    },
    [addFiles, camera],
  );

  const onDragOver = useCallback((event: DragDropEventLike): void => {
    // Files are the only thing this board can take, and saying so is what stops the browser drawing
    // its "not allowed here" line — and, on a drop, navigating the page to the file instead.
    const transfer = event.dataTransfer;
    if (!transfer || !hasFiles(transfer)) return;
    event.preventDefault();
    // The copy cursor of the golden path. It is a claim about what will happen — that this drops as a
    // new thing rather than moving the file out of the folder — and it is only true if it is set here.
    if (transfer.dropEffect !== 'copy') transfer.dropEffect = 'copy';
  }, []);

  const onPaste = useCallback(
    (event: ReactClipboardEvent<Element> | DropEventLike): void => {
      // A paste into a text field — a note, a shape's label, a free text object — belongs to that
      // field. The board only takes a paste when nobody is typing, and never eats one that somebody
      // else was going to do a better job of.
      if (isEditableTarget(event.target ?? null)) return;
      const pasted = eventFiles(event);
      if (pasted.length === 0) return;
      event.preventDefault();
      // A screenshot in the clipboard is the whole point of this door (image.paste), and it goes where
      // the picker's answer goes: the middle of the view, because there is no pointer in a Cmd+V.
      void addFiles(pasted, null);
    },
    [addFiles],
  );

  const openPicker = useCallback((): void => {
    if (!uploadReady(connection)) {
      // The button is not disabled, and this is why it is not: a person can be holding a picture while
      // a board reconnects. What they must not be able to do is hand it to a request that cannot be
      // confirmed and then stare at a box that never resolves.
      notify(REJECTION_MESSAGES.offline);
      return;
    }
    inputRef.current?.click();
  }, [connection, notify]);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const input = event.currentTarget;
      const picked: File[] = [];
      const list = input?.files;
      for (let index = 0; index < (list?.length ?? 0); index += 1) {
        const file = list?.item(index);
        if (file) picked.push(file);
      }
      // Cleared whatever happens next, so choosing the same file twice is two choices and not a change
      // event that never fired.
      if (input) input.value = '';
      // The Image button was never a mode: the moment the picker has been answered, the board is back
      // on Select (image.picker).
      onPickerSettled?.();
      if (picked.length === 0) return;
      // The same path as a drop, and centred like a paste: a picker has no pointer either.
      void addFiles(picked, null);
    },
    [addFiles, onPickerSettled],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (file === undefined) return false;
      // Back to 'uploading' before the request goes out, so the box stops claiming failure while it is
      // being tried again, and so the five-minute clock starts from this attempt rather than the first.
      markImageRetrying(doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  const canRetry = useCallback((id: string): boolean => files.current.has(id), []);

  /** The picker is a hidden input; clicking it from a ref keeps it out of the tab order. */
  const inputRef = useRef<HTMLInputElement | null>(null);

  const progressOf = useCallback(
    (id: string): number | undefined => {
      const fraction = progress.get(id);
      // Nothing is shown for a number that cannot be a percentage: 1 is reported by the picture itself
      // appearing, and that is a better progress bar than any number.
      return fraction === undefined || !(fraction > 0 && fraction < 1) ? undefined : fraction;
    },
    [progress],
  );

  const heldFiles = useCallback(() => [...files.current.keys()], []);

  const inputProps = useMemo<ImageFileInputProps>(
    () => ({
      type: 'file',
      // Built from the same list the validator reads, so the picker can never offer something the
      // board would refuse. The extensions are in the string because a `.heic` on a person's disk is
      // still not something this board can draw, and the picker should say so before the choice.
      accept: IMAGE_INPUT_ACCEPT,
      multiple: true,
      'data-testid': 'image-file-input',
      tabIndex: -1,
      'aria-hidden': true,
      onChange,
    }),
    [onChange],
  );

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    inputProps,
    progress,
    progressOf,
    retry,
    canRetry,
    heldFiles,
    // The hidden input's element, which `openPicker` clicks.
    inputRef,
  };
}
