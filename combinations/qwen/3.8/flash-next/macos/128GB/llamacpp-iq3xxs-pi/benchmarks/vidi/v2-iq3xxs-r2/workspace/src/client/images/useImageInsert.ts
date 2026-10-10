/**
 * Story 12: putting images on the board, whichever way they arrived (`image.insert`).
 *
 * Three ways in — drop, paste, and the Image tool's file picker — and they differ only in
 * where the images land and how the files were obtained. Everything after that is one flow:
 * refuse what cannot be uploaded and say why, measure what is left, create every placeholder
 * in one transaction, then upload each file and write its result back to the document. That
 * flow lives in one place here, so a PDF refuses itself the same no matter which door it
 * came through, and so a drop of six photos is one undo step rather than six.
 *
 * Two things are held deliberately in memory rather than in the document:
 *
 * - **Progress** is a per-viewer number. The uploader sees a percentage; everybody else sees
 *   the same box say "Uploading…", which is all they can honestly be told (`image.uploading`).
 *   Putting a moving number in the document would put every other person's screen in a
 *   feedback loop for no information they could use.
 * - **The `File` itself**, keyed by object id, is what Retry re-uploads (PRD: "upload the
 *   same file again"). A reload loses it, and the placeholder then belongs to
 *   `image.unfinished` — which is the honest outcome, because after a reload the browser has
 *   no permission to read the file back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point, Size } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { IMAGE_TYPE } from '../../shared/objects/image';
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
import { uploadImage, type UploadHandle } from './uploadImage';
import { showToast } from '../ui/Toast';

export interface ImageInsertArgs {
  doc: Y.Doc;
  /** Which board to upload to; the server refuses boards that do not exist. */
  boardId: string;
  /** For turning a drop point or the middle of the screen into board coordinates. */
  camera: Camera;
  /**
   * The size of the visible board area, which is where a paste or a pick lands. `Camera`
   * carries position and zoom but not size, so the hook needs the element's box as well —
   * this is the one argument the design's signature leaves out.
   */
  viewport: Size;
  connection: ConnectionState;
  /** This tab's identity, recorded as the uploader so the failed box knows whose it was. */
  identityId: string;
}

/**
 * The part of a drag event this hook needs, spelled out rather than taken from `lib.dom`:
 * the handler is called with React's synthetic event, which carries these and not the whole
 * of a `DragEvent`, and a board should not have to hand over more of the browser than it asks.
 */
export interface FileDropEventLike {
  preventDefault(): void;
  readonly clientX: number;
  readonly clientY: number;
  readonly dataTransfer: DataTransfer | null;
  readonly currentTarget: {
    getBoundingClientRect(): { left: number; top: number };
  };
}

/** The part of a paste event this hook needs (see `FileDropEventLike`). */
export interface PasteEventLike {
  preventDefault(): void;
  readonly target: EventTarget | null;
  readonly clipboardData: { readonly files: FileList | null } | null;
}

export interface ImageInsertControls {
  /** Must be called on dragover for the browser to allow a drop at all. */
  onDragOver(event: { preventDefault(): void; dataTransfer: DataTransfer | null }): void;
  onDrop(event: FileDropEventLike): void;
  onPaste(event: PasteEventLike): void;
  /** The Image button and the `i` key (PRD: "button or I key"). */
  openPicker(): void;
  /** Upload progress by image object id, for this tab's own uploads only. */
  progress: ReadonlyMap<string, number>;
  /** Re-upload the file this tab still holds for `id`, if it holds one. */
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

/**
 * Is this connection fit to upload to?
 *
 * Stricter than story 3's `canEdit`, and deliberately so: the board stays editable while it
 * is reconnecting because edits are kept locally and merged later, but an upload has nowhere
 * to go — the bytes have to reach the server or the image the document points at will not
 * exist (PRD: "WHILE the board is not connected THE SYSTEM SHALL NOT start image uploads").
 */
export function canUploadImages(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

/** Is this drag carrying files, as opposed to an object being moved round the board? */
export function hasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.types.includes('Files')) return true;
  return dataTransfer.files.length > 0;
}

/** Does this event come from somewhere that is editing text? (PRD: leave the paste to it.) */
function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * The natural size of an image file, or null when the browser cannot make a picture out of
 * it.
 *
 * This is the client's type check that does not trust the file's name: a PDF renamed to
 * `.png` says `image/png`, passes the MIME check, and then fails to decode, which is how the
 * person who renamed it finds out (`image.types`, TC-29). `createImageBitmap` is used rather
 * than an `<img>` because it never leaks a request or a blob URL and finishes with an error
 * rather than an `onerror` that has to be waited for by hand.
 */
async function naturalSize(file: File): Promise<Size | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    // The decoded bitmap holds a copy of the pixels in native memory; it is measured and then
    // thrown away, so it is closed rather than left for the collector.
    if (typeof bitmap.close === 'function') bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** One toast per kind of refusal, in a fixed order so a mixed batch reads sensibly. */
const REJECTION_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

function toastRejections(rejections: ReadonlySet<FileRejection>): void {
  for (const kind of REJECTION_ORDER) {
    if (rejections.has(kind)) showToast(REJECTION_MESSAGES[kind]);
  }
}

/**
 * Add `files` to the board.
 *
 * `at` is the drop point in board coordinates, or the middle of the visible area for a paste
 * and a pick; `anchor` says whether the row starts there or is centred on it
 * (`image.drop`, `image.paste`, `image.pick`).
 */
function addFiles(
  doc: Y.Doc,
  files: readonly File[],
  at: Point,
  anchor: 'top-left' | 'centre',
  identityId: string,
  keep: Map<string, File>,
  start: (id: string, file: File) => void,
  setProgress: (id: string, fraction: number | null) => void,
): void {
  const { accepted, rejections } = validateFiles(files);
  toastRejections(rejections);
  if (accepted.length === 0) return;

  // Everything after here is asynchronous, so the batch is measured first and placed once:
  // the row has to be laid out from final sizes, and a file that cannot be decoded is not
  // given a box to occupy in the meantime. `Promise.all` keeps the order the person chose —
  // `settled` is in the order the files were listed, not the order their decodes finished.
  void Promise.all(
    accepted.map(async (file): Promise<{ file: File; size: Size | null }> => ({
      file,
      size: await naturalSize(file),
    })),
  ).then((settled) => {
    const decoded = settled.filter((entry): entry is { file: File; size: Size } => entry.size !== null);
    if (decoded.length < settled.length) {
      // One message for all of them: the person dropped a folder, and six identical sentences
      // do not tell them anything more than one does.
      showToast(REJECTION_MESSAGES.type);
    }
    // Two sizes per picture, and mixing them up is the mistake this whole block is arranged to
    // avoid: the box on the board is the *placement* size — the natural size scaled down to
    // `IMAGE_MAX_PLACE_SIZE_WORLD` if it is bigger (`image.placement_size`) — while the natural
    // size travels with it, because the aspect ratio a resize has to keep is the picture's.
    const measured = decoded
      .map(({ file, size }) => ({ file, natural: size, place: placementSize(size.width, size.height) }))
      // A picture with no pixels to speak of is skipped rather than placed: an invisible object
      // on the board is a thing nobody can select and everybody has to explain.
      .filter(({ place }) => place.width > 0 && place.height > 0);
    if (measured.length === 0) return;
    const rects = layoutRow(
      measured.map(({ place }) => place),
      at,
      anchor,
    );
    const placements: ImagePlacement[] = measured.map(({ file, natural }, index) => ({
      rect: rects[index],
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      // `rect` carries the box, and the box is the placement size: the row was laid out from
      // exactly these numbers, which is the only way its gaps come out at one.
      contentType: file.type,
    }));

    // One transaction, so the drop is one undo step for this tab and one update for everyone
    // else, and never a row that arrives piece by piece (TC-05).
    const ids = createImagePlaceholders(doc, placements, identityId, Date.now());
    ids.forEach((id, index) => {
      const file = measured[index].file;
      keep.set(id, file);
      setProgress(id, 0);
      start(id, file);
    });
  });
}

/**
 * The board's image adding: the three event handlers, the picker, and what to draw for this
 * tab's own uploads.
 */
export function useImageInsert({
  doc,
  boardId,
  camera,
  viewport,
  connection,
  identityId,
}: ImageInsertArgs): ImageInsertControls {
  // Values that the asynchronous parts of this hook need long after the render that started
  // them, so an upload finishing three seconds later does not write to a stale document.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;

  // Not state, and not in the document: this tab's map of what it could still re-upload.
  const filesRef = useRef(new Map<string, File>());
  const uploadsRef = useRef(new Map<string, UploadHandle>());
  const [progress, setProgressState] = useState<ReadonlyMap<string, number>>(() => new Map());

  const setProgress = useCallback(
    (id: string, fraction: number | null): void => {
      setProgressState((current) => {
        const next = new Map(current);
        if (fraction === null) next.delete(id);
        else next.set(id, Math.max(0, Math.min(1, fraction)));
        return next;
      });
    },
    [],
  );

  /**
   * Upload one file for one object, and write whatever comes of it back to the document.
   *
   * The document is written even when this tab has stopped watching the object: if the person
   * deleted the placeholder while its bytes were still travelling, `markImageReady` finds
   * nothing and says so, which is the correct end of that story.
   */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      uploadsRef.current.get(id)?.abort();
      const handle = uploadImage(boardId, file, (fraction) => setProgress(id, fraction));
      uploadsRef.current.set(id, handle);
      void handle.promise.then((result) => {
        if (uploadsRef.current.get(id) === handle) uploadsRef.current.delete(id);
        setProgress(id, null);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
          return;
        }
        // The box stays, in the state the PRD calls "Upload failed": a person who dropped a
        // photo and had it vanish would assume somebody else deleted it.
        markImageFailed(doc, id);
      });
    },
    [boardId, doc, setProgress],
  );

  /** The common tail of all three ways in, once the point in the board is known. */
  const addAt = useCallback(
    (at: Point, anchor: 'top-left' | 'centre', files: readonly File[]): void => {
      if (!canUploadImages(connectionRef.current)) {
        // Nothing is added and nothing is queued: a placeholder whose bytes cannot be
        // uploaded is a hole in the document with a message attached.
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      addFiles(
        doc,
        files,
        at,
        anchor,
        identityRef.current,
        filesRef.current,
        startUpload,
        setProgress,
      );
    },
    [boardId, doc, setProgress, startUpload],
  );

  /** The point in the middle of what this person can see, in board coordinates. */
  const viewCentre = useCallback(
    (): Point =>
      screenToWorld(cameraRef.current, {
        x: viewportRef.current.width / 2,
        y: viewportRef.current.height / 2,
      }),
    [],
  );

  const onDragOver = useCallback(
    (event: { preventDefault(): void; dataTransfer: DataTransfer | null }): void => {
      // Without this the browser shows its "no drop" cursor and fires no `drop`.
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    },
    [],
  );

  const onDrop = useCallback(
    (event: FileDropEventLike): void => {
      if (!hasFiles(event.dataTransfer)) return; // an object being dragged round the board
      event.preventDefault();
      // The viewport's own box, because a drop point is reported against the window and the
      // camera works in the board's surface, which is not the same rectangle.
      const box = event.currentTarget.getBoundingClientRect();
      const world = screenToWorld(cameraRef.current, {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
      // The first image's top-left corner goes where the cursor was (PRD: "its top-left
      // corner starting at the drop point"), and the rest follow it to the right.
      addAt(world, 'top-left', Array.from(event.dataTransfer?.files ?? []));
    },
    [addAt],
  );

  const onPaste = useCallback(
    (event: PasteEventLike): void => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return; // plain text, which this board lets the editor have
      // A paste that the person meant for a sticky note, a text object or a label: the caret
      // is the authority on whose paste this is (PRD: "IF text is being edited").
      if (isEditingText(event.target)) return;
      event.preventDefault();
      addAt(viewCentre(), 'centre', files);
    },
    [addAt, viewCentre],
  );

  /**
   * The system file picker, filtered to the kinds this board serves and allowing several.
   *
   * The input is created here and never rendered, because a hidden `<input>` in the board's
   * markup is a control that can be tabbed to and cannot be seen. Offline, the picker is not
   * opened at all (TC-19's `picker not opened`): asking somebody to choose a file and then
   * telling them it cannot be used is a worse conversation than not starting it.
   */
  const openPicker = useCallback((): void => {
    if (!canUploadImages(connectionRef.current)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png, image/jpeg, image/gif, image/webp';
    input.setAttribute('data-testid', 'image-picker');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length === 0) return;
      addAt(viewCentre(), 'centre', files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
    });
    document.body.append(input);
    input.click();
  }, [addAt, viewCentre]);

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false; // the File is in memory or the Retry button is not there
      if (!canUploadImages(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return false;
      }
      // A fresh clock, so the other viewers' five minutes start again rather than running out
      // halfway through the second attempt.
      markImageRetrying(doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  // An upload that is still travelling when this board is left behind has nowhere to finish:
  // the document it would have been written to belongs to another board by then.
  useEffect(
    () => () => {
      for (const handle of uploadsRef.current.values()) handle.abort();
      uploadsRef.current.clear();
    },
    [],
  );

  // `image.uploading` for the uploader: the ids this tab is watching, so a placeholder can be
  // asked whether it has a percentage to show.
  return useMemo(
    () => ({ onDragOver, onDrop, onPaste, openPicker, progress, retry, canRetry }),
    [canRetry, onDragOver, onDrop, onPaste, openPicker, progress, retry],
  );
}

/** Is `object` an image object? Used by the board to decide whether it needs a clock. */
export function isImageObject(object: { type: string }): boolean {
  return object.type === IMAGE_TYPE;
}
