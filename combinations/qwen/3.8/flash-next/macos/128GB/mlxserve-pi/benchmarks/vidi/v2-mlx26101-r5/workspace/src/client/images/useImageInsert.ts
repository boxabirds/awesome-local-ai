/**
 * The three ways a picture gets onto a board, and the one way it gets uploaded.
 *
 * Drop, paste and picker are three different gestures that agree about everything after the first
 * second: the files are validated, measured, placed, written into the document as placeholders, and sent
 * to the bucket one by one while the placeholder says how far along each one is. That agreement is why
 * this is one hook with one private `addFiles` and three thin listeners in front of it, rather than three
 * flows that each remember to check the size limit — three flows is three places for a rule to be
 * forgotten, and the rule people notice is the one that was forgotten.
 *
 * Four decisions in here are worth their weight in the rest of the story:
 *
 * - **The placeholder is written before the upload starts, not after it finishes.** The object exists with
 *   `status: 'uploading'` and its final size and position, so it travels to everybody else on the board
 *   like any other object and they see a grey box of the right size where the picture is going to be
 *   (PRD `image.uploading`) — and the uploader sees a progress bar in a box that is already where it will
 *   stay. A client that added the object only when the bytes arrived would give everybody else nothing to
 *   look at for as long as the upload took, which is the moment this story was written to fill.
 * - **The connection gate is stricter than the board's own.** `canEdit` allows writing while the line is
 *   down, because a Yjs update written during a reconnect is held and sent when the line comes back. An
 *   HTTP upload has no such patience: it fails now, or it goes to a board nobody is on. So images ask for
 *   `connected` and say the PRD's sentence about it, and they say it *instead* of opening a file picker —
 *   a picker that accepts a file and then refuses it is a picker that lied.
 * - **The dimension comes from the decoder, not from the file.** `createImageBitmap` is what says how big
 *   a picture is, because a browser that can draw it already knows; the server is never asked and no
 *   image library is shipped. A file the decoder refuses is a file that will not draw in an `<img>`
 *   either, so a decode failure is reported as the type message and the file is skipped — and the other
 *   files in that drop still go in.
 * - **The file for Retry is kept in memory and nowhere else.** Not in the document (it would be a
 *   megabyte of base64 in a CRDT), not in IndexedDB (a board that remembers a closed tab's file is a board
 *   with a private filing cabinet). Reload the page and the placeholder's Retry is gone, which is exactly
 *   what the PRD's "upload resumption after page reload" out-of-scope line says, and after five minutes
 *   even the uploader is told the truth about it (`image.unfinished`).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import type * as Y from 'yjs';

import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  layoutRow,
  placementSize,
  type RowAnchor,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { BoardStatus } from '../board/connection';
import { isTypingTarget } from '../objects/TextEditor';
import { showToast } from '../ui/Toast';
import { messagesFor, REJECTION_MESSAGES, rejectionMessages, validateFiles } from './validateFiles';
import { uploadImage, type ImageUpload } from './uploadImage';

/** How big a decoded picture is, in pixels — one pixel per board unit at placement time. */
interface NaturalSize {
  width: number;
  height: number;
}

export interface UseImageInsertArgs {
  /** The board's document, which is where a picture's placeholder is written. */
  doc: Y.Doc;
  /** Which board the bytes are uploaded to; empty for a board of one, which cannot upload anything. */
  boardId: string;
  /** Where this person is looking, for the two entries that have no drop point of their own. */
  camera: Camera;
  /** The room's state: an upload needs a live line, not merely a document that is willing to be written. */
  connection: BoardStatus;
  /** Whose upload this is: the string every other screen compares against to decide whose buttons to show. */
  identityId: string;
}

export interface ImageInsertControls {
  /** Lets the browser drop files on the board — and only files: a dragged piece of text stays the browser's. */
  onDragOver(event: ReactDragEvent<HTMLElement>): void;
  /** The drop itself: the files land here, in world coordinates, wherever the pointer said. */
  onDrop(event: ReactDragEvent<HTMLElement>): void;
  /** A paste on the board (not in a text field) that held image files. */
  onPaste(event: ReactClipboardEvent<HTMLElement>): void;
  /** The Image button and the I key: opens the system picker, unless there is nothing to upload to. */
  openPicker(): void;
  /**
   * How far along each of *this person's* uploads is, 0…1, by placeholder id.
   *
   * Local state and not document state, and that is not an oversight: the percentage is a property of a
   * transfer this browser is making, so broadcasting it would put a number on everybody else's screen that
   * they have no way to check and nobody asked for. Everybody else sees the placeholder; the person who
   * dropped the file sees the bar.
   */
  progress: ReadonlyMap<string, number>;
  /** Sends the file this browser still holds for this placeholder again. False when it does not hold it. */
  retry(id: string): boolean;
  /** Whether Retry is worth offering: the file is in this tab's memory (TC-24). */
  canRetry(id: string): boolean;
}

/**
 * What a drop says that no other event says: what is being carried, where it was let go, and over what.
 *
 * Written as a shape rather than as `DragEvent`, because the same handling is needed by a React synthetic
 * event — the one the board's `onDrop` gets — and by a native one, and the two are different types that
 * happen to answer the same three questions. Naming the questions is shorter than converting between them,
 * and it is the reason this file is not tied to whichever event system is holding the files.
 */
interface DropLike {
  readonly dataTransfer: DataTransfer | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
}

/** What a paste says: what was in the clipboard, and who was being typed into at the time. */
interface PasteLike {
  readonly target: EventTarget | null;
  readonly clipboardData: { readonly files: FileList } | null;
  preventDefault(): void;
}

/** A drop, a paste or a pick: the point it happened at, and which end of the row that point is. */
interface DropTarget {
  at: Point;
  anchor: RowAnchor;
}

const NO_PROGRESS: ReadonlyMap<string, number> = new Map();

/** Does this drag carry files, as opposed to a selection, a link or an image dragged out of another page? */
function hasFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (dataTransfer === null || dataTransfer === undefined) return false;
  const types: readonly string[] = Array.from(dataTransfer.types ?? []);
  return types.includes('Files');
}

function filesOf(dataTransfer: DataTransfer | null | undefined): File[] {
  return listOf(dataTransfer?.files);
}

/** A `FileList` as an array — the same list, in the shape the rest of this file works with. */
function listOf(list: FileList | undefined | null): File[] {
  if (list === undefined || list === null) return [];
  return Array.from(list);
}

/** The middle of what this person can see, in board units. */
function viewCentre(camera: Camera): Point {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return screenToWorld(camera, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
}

/**
 * What these bytes make, size-wise — or null when the decoder wants nothing to do with them.
 *
 * The browser is asked rather than the file being read, because a browser that can put a picture on screen
 * has already answered "how big is it" for itself, and because the four formats disagree about where in the
 * file their dimensions live (PNG in IHDR, JPEG in a start-of-frame marker, GIF in the logical screen
 * descriptor, WebP in one of three possible chunk layouts) — which is a decoder, and we already ship one.
 *
 * `createImageBitmap` is the cheap half of that decoder: it gives the bitmap and never paints it. The
 * bitmap is closed straight away, because four screenshots' worth of RGBA held in memory for as long as
 * the upload took would be a hundred and thirty megabytes for no reason at all.
 */
async function naturalSize(file: File): Promise<NaturalSize | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // A file that decodes to nothing draws nothing: the same message as a file of the wrong type, because
    // from where this browser sits the two are one question — will this be a picture.
    return null;
  }
  const size: NaturalSize = { width: bitmap.width, height: bitmap.height };
  // Not every implementation has close(); the ones that do are the ones that need it.
  bitmap.close?.();
  if (!(size.width > 0) || !(size.height > 0)) return null;
  return size;
}

/**
 * The board's picture-adding: drop, paste, picker, progress, retry.
 *
 * Every entry point ends in the same four lines — validate, measure, place, upload — and the differences
 * between them are only ever *where* the row goes and *whether there is a drop point at all*.
 */
export function useImageInsert({
  doc,
  boardId,
  camera,
  connection,
  identityId,
}: UseImageInsertArgs): ImageInsertControls {
  const docRef = useRef(doc);
  docRef.current = doc;
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;

  /** Placeholder id → the file this tab is holding for it. The whole of Retry's memory. */
  const filesRef = useRef(new Map<string, File>());
  /** Placeholder id → the upload in flight, so it can be stopped when this board goes away. */
  const uploadsRef = useRef(new Map<string, ImageUpload>());

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(NO_PROGRESS);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  /**
   * One placeholder's percentage, or nothing when it has no upload left to report.
   *
   * A new Map each time, because a Map that is mutated in place is a Map React cannot see: the progress bar
   * is rendered from this map, so every percentage has to arrive as a different value or the bar would be
   * painted once and never again — which is the exact "uploads look like nothing is happening" this story
   * is written against, reproduced in the component that was supposed to fix it.
   */
  const reportProgress = useCallback((id: string, fraction: number | null): void => {
    const next = new Map(progressRef.current);
    if (fraction === null) next.delete(id);
    else next.set(id, fraction);
    progressRef.current = next;
    setProgress(next);
  }, []);

  /** One upload, from the placeholder that already exists to the key the bucket gives it. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      const upload = uploadImage(boardIdRef.current, file, (fraction) => reportProgress(id, fraction));
      uploadsRef.current.set(id, upload);
      void upload.promise.then((result) => {
        // Whichever answer comes back, this browser's half of the work is over: the number goes away and
        // the document says what happened. Both writes are made with the untracked origin, so the arrival or
        // the failure is not an undo step of its own — the add already was one.
        if (uploadsRef.current.get(id) === upload) uploadsRef.current.delete(id);
        reportProgress(id, null);
        if (result.kind === 'ok') {
          filesRef.current.delete(id);
          markImageReady(docRef.current, id, result.assetKey);
        } else {
          // The file stays in `filesRef`: that is what makes Retry offer something.
          markImageFailed(docRef.current, id);
        }
      });
    },
    [reportProgress],
  );

  /**
   * The one flow. Files in, a place for them, and everything after that is the same for all three doors.
   *
   * Note what happens with a mixed batch: the message is shown first and the good files go in anyway,
   * because "the PDF was refused" and "your three screenshots are uploading" are both true and neither is
   * a reason to stop the other.
   */
  const addFiles = useCallback(
    (files: readonly File[], target: DropTarget): void => {
      if (connectionRef.current !== 'connected') {
        // Nothing at all is written to the document: a placeholder with no connection behind it is a
        // placeholder that can never become a picture, and would sit there until somebody removed it.
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      const validated = validateFiles(files);
      // Every reason the batch met, said at once, before the good files go in: "the PDF was refused" and
      // "your three screenshots are uploading" are both true, and the line says both. The set is kept because
      // the decoder may add a reason to it further down, and a second toast that repeats the first with one
      // more sentence in it is a sentence the person has already read.
      const reasons = new Set(validated.rejections);
      const said = rejectionMessages(validated);
      if (said !== '') showToast(said);
      const accepted = validated.accepted;
      if (accepted.length === 0) return;

      void (async () => {
        const sized: { file: File; size: NaturalSize }[] = [];
        let undecodable = 0;
        for (const file of accepted) {
          const size = await naturalSize(file);
          if (size === null) undecodable += 1;
          else sized.push({ file, size });
        }
        if (undecodable > 0 && !reasons.has('type')) {
          // A file that would not decode is a type reason, and nothing before this point could have known it:
          // the name said `.png` and the byte count was legal. The line is said again with the new reason in
          // it rather than a second line being spoken over the first.
          reasons.add('type');
          showToast(messagesFor(reasons));
        }
        if (sized.length === 0) return;

        const sizes = sized.map((entry) => placementSize(entry.size.width, entry.size.height));
        const rects = layoutRow(sizes, target.at, target.anchor);
        const ids = createImagePlaceholders(
          docRef.current,
          sized.map((entry, index) => ({
            rect: rects[index] as (typeof rects)[number],
            naturalWidth: entry.size.width,
            naturalHeight: entry.size.height,
            contentType: entry.file.type,
          })),
          identityRef.current,
          Date.now(),
        );
        ids.forEach((id, index) => {
          const file = sized[index]?.file;
          if (file === undefined) return;
          filesRef.current.set(id, file);
          startUpload(id, file);
        });
      })();
    },
    [startUpload],
  );

  /** The point on the board a drag ended at, in world units. */
  const dropPoint = useCallback((event: DropLike): Point => {
    const rect = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    return screenToWorld(cameraRef.current, {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    });
  }, []);

  const onDragOver = useCallback((event: DropLike): void => {
    // Only files. Text dragged from another page is a thing a person means to paste somewhere and is left
    // to the browser; a drop of files that nobody prevented gets as far as the address bar and replaces the
    // board with the file, which is the worst possible outcome of a drag that was going well.
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: DropLike): void => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      const files = filesOf(event.dataTransfer);
      if (files.length === 0) return;
      // A drop names its own spot: the first picture's top-left corner goes exactly where the pointer was
      // released and the row runs to the right of it (PRD `image.drop`).
      addFiles(files, { at: dropPoint(event), anchor: 'top-left' });
    },
    [addFiles, dropPoint],
  );

  const onPaste = useCallback(
    (event: PasteLike): void => {
      // A field that is being typed into answers its own paste: text into a note's text, exactly as it did
      // before this story existed. The board only takes the paste when nothing is holding the caret.
      const target: EventTarget | null = event.target ?? (typeof document === 'undefined' ? null : document.activeElement);
      if (isTypingTarget(target)) return;
      if (isTypingTarget(document.activeElement)) return;
      const files = listOf(event.clipboardData?.files);
      // A paste of text, or of nothing at all, is not this story's business and gets no message: a board
      // that toasts every Ctrl+V is a board that has started talking to itself.
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files, { at: viewCentre(cameraRef.current), anchor: 'centre' });
    },
    [addFiles],
  );

  // The paste listener lives here rather than in the board: this hook owns the rule about which pastes are
  // its own, and a listener wired up by the caller is one more place the rule can be left out.
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;
  useEffect(() => {
    const handler = (event: Event): void => pasteRef.current(event as unknown as PasteLike);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);

  /**
   * The hidden file input behind the Image button and the I key.
   *
   * Made once per board and reused, with its value cleared before every opening: an input that still holds
   * last time's files will not fire `change` when the same file is chosen twice in a row, and a person who
   * picked a file, removed it from the board and picked it again would have clicked a button that does
   * nothing. `accept` is the picker's filter and nothing more — a courtesy to the person choosing, not a
   * check, which is why the same files are validated again the moment they come back.
   */
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const openPicker = useCallback((): void => {
    if (connectionRef.current !== 'connected') {
      // Said instead of opening the picker, not after: a file picker that lets a person choose a file the
      // board has already decided it cannot take is a longer way of saying no.
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    if (typeof document === 'undefined') return;
    let existing = pickerRef.current;
    if (existing === null) {
      const created: HTMLInputElement = document.createElement('input');
      created.type = 'file';
      created.multiple = true;
      created.accept = IMAGE_ACCEPTED_TYPES.join(',');
      created.className = 'image-picker-input';
      // The board's own name for this node, so that a test — and anybody reading the DOM — can tell the
      // board's file input from a file input some other part of the page had made.
      created.dataset.testid = 'image-picker-input';
      created.hidden = true;
      created.addEventListener('change', () => {
        const files = listOf(created.files);
        // Cleared before anything else: whatever happens to these files, the next opening starts empty.
        created.value = '';
        if (files.length === 0) return;
        // A picked file has no drop point: it goes in the middle of what this person can see.
        addFiles(files, { at: viewCentre(cameraRef.current), anchor: 'centre' });
      });
      existing = created;
      pickerRef.current = created;
      document.body.appendChild(created);
    }
    existing.click();
  }, [addFiles]);

  // The picker is a DOM node this hook made, so this hook takes it out again.
  useEffect(
    () => () => {
      pickerRef.current?.remove();
      pickerRef.current = null;
      for (const upload of uploadsRef.current.values()) upload.abort();
      uploadsRef.current.clear();
    },
    [],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false;
      // The clock is rewound with it, so a placeholder that had gone grey and stale visibly starts again
      // rather than being re-uploaded while still looking abandoned.
      markImageRetrying(docRef.current, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  return useMemo(
    () => ({ onDragOver, onDrop, onPaste, openPicker, progress, retry, canRetry }),
    [onDragOver, onDrop, onPaste, openPicker, progress, retry, canRetry],
  );
}
