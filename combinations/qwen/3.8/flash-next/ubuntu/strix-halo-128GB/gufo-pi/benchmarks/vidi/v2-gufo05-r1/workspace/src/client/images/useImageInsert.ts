/**
 * Getting pictures onto the board: drop, paste and the Image tool (`image.insert`).
 *
 * One flow with three front doors. Each of them ends in the same six steps — ask whether
 * this board can be written to, sort the files into added and refused, decode the added ones
 * to find out how big they are, write all of their placeholders as one undo step, upload them
 * and write the status each upload came back with — and the reason they share a hook rather
 * than three implementations is that the differences between them are only *where* the images
 * land and *what the keyboard was doing* at the time:
 *
 * - **Drop** puts the first image's top-left corner under the cursor and the rest in a row to
 *   its right (`image.drop`), with a dashed highlight while the files hover.
 * - **Paste** centres the row in the visible area, because a clipboard picture has no point to
 *   land on — and it steps aside completely when a text field has the caret, so pasting words
 *   into a note stays pasting words (`image.paste`).
 * - **The picker** (the Image button, or `I`) also centres the row, and is only opened when
 *   the board can be written to at all, rather than opening it and refusing what comes back
 *   (`image.pick`).
 *
 * Two things are deliberately not in the document. Upload *progress* is in memory only, for
 * this tab: it changes many times a second, everybody else only needs to know that something
 * is uploading (the placeholder's `status` says that, in one field, once), and a fraction
 * streamed down the wire would be noise. The `File` behind each placeholder is kept in memory
 * for the same reason Retry can work — and just as honestly lost on reload, which is why
 * `canRetry` answers false afterwards and the object offers only Remove.
 *
 * Every failure is a message or a state, never an exception: a board that refused forty files
 * is a board with a toast on it, not a board with a broken handler.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { takesTextKeys } from '../dom/textTarget';
import type { ConnectionState } from '../sync/connectBoard';
import { showToast } from '../ui/Toast';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';

/** Where a row of images is put down. */
type Placement = { anchor: 'top-left'; point: Point } | { anchor: 'centre' };

/** A file that survived validation and decoding, with the size it decoded to. */
interface Measured {
  file: File;
  width: number;
  height: number;
}

/**
 * The part of a drag this hook reads.
 *
 * Written as a shape rather than as `DragEvent` because the same handler is put on React's
 * `onDrop` and on the window's own listener, and React hands a synthetic event to the first and
 * the browser a real one to the second. Both of them have these five things, which is all the
 * board needs to know about a drag.
 */
export interface DragGesture {
  dataTransfer: DataTransfer | null;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  relatedTarget: EventTarget | null;
  preventDefault(): void;
}

/** The part of a paste this hook reads, in the same spirit (`image.paste`). */
export interface PasteGesture {
  target: EventTarget | null;
  clipboardData: DataTransfer | null;
  preventDefault(): void;
}

export interface ImageInsertArgs {
  /** The shared document the placeholders are written into. */
  doc: Y.Doc;
  /** Which board to upload to. Empty means this document is not on a server at all. */
  boardId: string;
  /** The camera, to turn a drop point and the middle of the view into world coordinates. */
  camera: Camera;
  /** Story 3's connection state: an add needs one that is up (`image.offline`). */
  connection: ConnectionState;
  /** Whose upload this is — the id the placeholder records. */
  identityId: string;
  /**
   * Close the undo capture window.
   *
   * The placeholders of one action are written in one transaction, and the boundary is what
   * keeps that transaction from also absorbing whatever was done just before it — the same
   * courtesy every other create on the board pays (`undo.steps`).
   */
  boundary?(): void;
}

export interface ImageInsertHandle {
  /** Drag files over the board: allow the drop, and show the highlight. */
  onDragOver(event: DragGesture): void;
  /** The drag left the board. Only the leave that left *it*, not the ones between children. */
  onDragLeave(event: DragGesture): void;
  /** Let go: add the files at the point under the cursor. */
  onDrop(event: DragGesture): void;
  /** Paste: add clipboard images, unless something is taking text keys. */
  onPaste(event: PasteGesture): void;
  /** Open the system picker. Refused, with the offline message, when nothing could be uploaded. */
  openPicker(): void;
  /** Object id → 0–1, for the uploads this tab is running. */
  progress: ReadonlyMap<string, number>;
  /** Upload the same file again. False when this tab no longer has it. */
  retry(id: string): boolean;
  /** Does Retry have anything to retry? */
  canRetry(id: string): boolean;
  /** Files are being dragged over the board right now (`image.drop`). */
  dropActive: boolean;
  /** Stop keeping a file: its object is gone, so nothing can ever retry it. */
  forget(id: string): void;
}

/**
 * Is this board up for sending a file to?
 *
 * `connected` and `confirmed` only. A board that is `connecting` has no server on the other
 * end yet, and a `reconnecting` one may not have it for another minute — and a picture is
 * the one object whose *bytes* have to reach that server, unlike text, which can wait in the
 * document and sync later (`image.offline`).
 */
function canUpload(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

/**
 * Does this drag carry files?
 *
 * `types` is the only part of a foreign drag a page is allowed to read before the drop, and
 * it is enough: a person dragging a photo from a file manager is distinguished from a person
 * dragging selected text by exactly this one entry.
 */
function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

/** Files, in the order the person's hand reached them. */
function filesOf(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.files);
}

/**
 * The picture's real pixel size, from the decoder rather than from the file name.
 *
 * `createImageBitmap` is what the board already uses for measuring, and it answers both
 * questions the placeholder needs in one go: whether these bytes are a picture at all, and
 * how big. A file that passes `validateFiles` (its declared type is one of the four) and then
 * fails to decode is a corrupt file, and gets the same message — from the person's point of
 * view there is no difference between "not an image" and "an image that isn't".
 */
async function measure(file: File): Promise<Measured | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close?.();
    if (!(width > 0) || !(height > 0)) return null;
    return { file, width, height };
  } catch {
    return null;
  }
}

export function useImageInsert(args: ImageInsertArgs): ImageInsertHandle {
  const { doc, boardId, camera, connection, identityId, boundary } = args;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dropActive, setDropActive] = useState(false);

  // The latest camera and connection, for the handlers that are created once and for the
  // callbacks that outlive the render they were made in.
  const latest = useRef({ doc, boardId, camera, connection, identityId, boundary });
  latest.current = { doc, boardId, camera, connection, identityId, boundary };

  /** Object id → the bytes it stands for, kept only as long as a Retry could use them. */
  const files = useRef(new Map<string, File>());
  /** Object id → the upload in flight, so nothing uploads the same placeholder twice. */
  const inflight = useRef(new Map<string, UploadHandle>());
  /** The picker, made once and reused: a fresh input per press would leak elements. */
  const picker = useRef<HTMLInputElement | null>(null);

  const writeProgress = useCallback((id: string, fraction: number | null) => {
    setProgress((current) => {
      const next = new Map(current);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  /** Send one file for one placeholder, and write whatever came back. */
  const startUpload = useCallback(
    (id: string, file: File) => {
      const current = latest.current;
      files.current.set(id, file);
      inflight.current.get(id)?.abort();
      writeProgress(id, 0);

      const handle = uploadImage(current.boardId, file, (fraction) => {
        writeProgress(id, fraction);
      });
      inflight.current.set(id, handle);

      void handle.promise.then((result) => {
        // An aborted upload still answers — `abort()` ends the request, and the request reports
        // that it ended — so a Retry's cancelled attempt has to be recognised as the one that
        // just finished, or it would mark the object `failed` on top of the retry that is
        // already running.
        if (inflight.current.get(id) !== handle) return;
        inflight.current.delete(id);
        writeProgress(id, null);
        if (result.kind === 'ok') {
          // The key goes into the document with an origin the undo history does not watch:
          // "the upload finished" is the tail of the add action, not a step of its own
          // (`image.add_one_step`).
          markImageReady(current.doc, id, result.assetKey);
          files.current.delete(id);
        } else {
          markImageFailed(current.doc, id);
        }
      });
    },
    [writeProgress],
  );

  /**
   * The shared tail of every add action.
   *
   * Async because it decodes the files first, which is the only honest way to know the size a
   * placeholder is drawn at (`image.placement_size`) — and it is the reason the placeholders
   * are written once, after the decoding, rather than file by file: twenty decoded files are
   * still one thing the person did, and one thing Undo has to take back (`image.add_one_step`).
   */
  const insertFiles = useCallback(
    async (received: readonly File[], placement: Placement) => {
      const current = latest.current;
      if (received.length === 0) return;
      if (current.boardId === '' || !canUpload(current.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(received);
      // One message per kind of refusal, in the order they were decided
      // (`image.types`, `image.size_limit`, `image.count_limit`).
      for (const kind of ['type', 'size', 'count'] as const) {
        if (rejections.has(kind)) showToast(REJECTION_MESSAGES[kind]);
      }
      if (accepted.length === 0) return;

      const measured = await Promise.all(accepted.map(measure));
      const usable = measured.filter((item): item is Measured => item !== null);
      if (usable.length < accepted.length) {
        // It claimed to be a PNG and would not decode: the same words, because the same
        // thing happened to the person — a picture that will not appear.
        showToast(REJECTION_MESSAGES.type);
      }
      if (usable.length === 0) return;

      const sizes = usable
        .map((item) => placementSize(item.width, item.height))
        .filter((size): size is NonNullable<typeof size> => size !== null);
      if (sizes.length === 0) return;

      const point =
        placement.anchor === 'centre'
          ? // The middle of the visible board. The viewport fills the window, so the window
            // is the board's measure — the same measure the sticky note button uses.
            screenToWorld(current.camera, {
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            })
          : placement.point;
      const rects = layoutRow(sizes, point, placement.anchor);

      const items = usable.flatMap((item, index) => {
        const rect = rects[index];
        if (!rect) return [];
        return [
          {
            file: item.file,
            rect,
            naturalWidth: item.width,
            naturalHeight: item.height,
            contentType: item.file.type,
          },
        ];
      });

      current.boundary?.();
      const ids = createImagePlaceholders(current.doc, items, current.identityId, Date.now());
      current.boundary?.();

      // `createImagePlaceholders` drops items it cannot place, so the ids it hands back are
      // the ones, and only the ones, that exist to be written to.
      ids.forEach((id, index) => {
        const file = items[index]?.file;
        if (file) startUpload(id, file);
      });
    },
    [startUpload],
  );

  const onDragOver = useCallback((event: DragGesture) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !carriesFiles(dataTransfer)) return;
    // Without this the browser performs its own default (open the file, or navigate to it)
    // and the drop event never reaches the board.
    event.preventDefault();
    dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }, []);

  const onDragLeave = useCallback((event: DragGesture) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Moving from the board onto a note inside it fires a leave as well. Only the leave that
    // ended up outside the board is a leave from the board — otherwise the highlight would
    // flicker across every object the cursor passes.
    const goingTo = event.relatedTarget;
    const board = event.currentTarget;
    if (goingTo instanceof Node && board instanceof Node && board.contains(goingTo)) return;
    setDropActive(false);
  }, []);

  const onDrop = useCallback(
    (event: DragGesture) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDropActive(false);
      const dropped = filesOf(event.dataTransfer);
      if (dropped.length === 0) return;
      // The point under the cursor, in world coordinates: where the person aimed is where the
      // first image's corner goes (`image.drop`).
      const point = screenToWorld(latest.current.camera, { x: event.clientX, y: event.clientY });
      void insertFiles(dropped, { anchor: 'top-left', point });
    },
    [insertFiles],
  );

  const onPaste = useCallback(
    (event: PasteGesture) => {
      // A caret somewhere that takes text owns the clipboard (`image.paste`). This handler is
      // on the window, so it is asked about every paste on the page, including the one a
      // person is making into a note — and that one must not also put a picture on the board.
      if (takesTextKeys(event.target)) return;
      // `clipboardData` is the standard name for the same `DataTransfer` a drop carries, and
      // it is the one every browser that fires `paste` implements.
      const pasted = filesOf(event.clipboardData);
      if (pasted.length === 0) return;
      event.preventDefault();
      void insertFiles(pasted, { anchor: 'centre' });
    },
    [insertFiles],
  );

  const openPicker = useCallback(() => {
    const current = latest.current;
    // Refused before the picker opens, not after the file is chosen: a dialog that collects
    // a picture the board then throws away is worse than a button that says no
    // (`image.offline`).
    if (current.boardId === '' || !canUpload(current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.multiple = true;
    // Out of the layout, but not `display: none`: Safari ignores a click on a hidden input.
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.tabIndex = -1;
    input.setAttribute('aria-label', 'Choose images to add');
    picker.current?.remove();
    picker.current = input;
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const chosen = Array.from(input.files ?? []);
      input.remove();
      if (picker.current === input) picker.current = null;
      // Choosing nothing is the person having changed their mind: no message, nothing added
      // (`image.pick`).
      if (chosen.length === 0) return;
      void insertFiles(chosen, { anchor: 'centre' });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      if (picker.current === input) picker.current = null;
    });
    input.click();
  }, [insertFiles]);

  const retry = useCallback(
    (id: string) => {
      const file = files.current.get(id);
      if (!file) return false;
      const current = latest.current;
      // Back to `uploading` with a fresh clock: the placeholder was stale, and the person
      // watching it is entitled to see it become live again rather than stay "didn't finish".
      if (!markImageRetrying(current.doc, id, Date.now())) {
        files.current.delete(id);
        return false;
      }
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  const canRetry = useCallback((id: string) => files.current.has(id), []);

  const forget = useCallback((id: string) => {
    files.current.delete(id);
    inflight.current.get(id)?.abort();
    inflight.current.delete(id);
    setProgress((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  // A tab that goes away mid-upload takes its uploads with it. The placeholders are left in
  // the document — that is what `unfinished` is for — but nothing here should keep a socket
  // open for a board that is no longer mounted.
  useEffect(
    () => () => {
      for (const handle of inflight.current.values()) handle.abort();
      inflight.current.clear();
      picker.current?.remove();
      picker.current = null;
    },
    [],
  );

  return {
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
    dropActive,
    forget,
  };
}
