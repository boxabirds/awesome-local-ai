import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { IMAGE_SNIFF_BYTES } from "../../shared/config";
import { sniffImageType, type AcceptedImageType } from "../../shared/image-format";
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  layoutRow,
  type ImagePlacement,
  type ImageSize,
} from "../../shared/objects/image";
import type { Point } from "../../shared/geometry";
import type { Camera } from "../canvas/camera";
import { screenToWorld } from "../canvas/camera";
import { useUndoBoundary } from "../board/useUndo";
import type { ConnectionState } from "../sync/connection-state";
import { showToast } from "../ui/Toast";
import { FILE_PICKER_ACCEPT, uploadImage, type UploadHandle, type UploadResult } from "./uploadImage";
import { REJECTION_MESSAGES, rejectionMessages, validateFiles } from "./validateFiles";

/**
 * `image.insert` — the three ways an image gets onto the board.
 *
 * Drop, paste and the file picker are different gestures over one flow:
 *
 * ```
 * files → online? → validate (type, size, count) → sniff + decode for natural
 *         size → layoutRow → createImagePlaceholders (one undo step) → upload each
 * ```
 *
 * Two things about that order matter more than the rest:
 *
 * - **Offline first.** `image.offline`: if this tab is not in sync with the room,
 *   nothing is created at all. A placeholder nobody else can see, for an upload
 *   that cannot start, is a board full of objects that will never become images.
 * - **Content, never a name.** `image.types`: `validateFiles` filters on what the
 *   browser says the file is, and then the file's first `IMAGE_SNIFF_BYTES` are
 *   read and run through the *same* sniffer the Worker uses, and the file is
 *   decoded for its real pixel size. A PDF named `photo.png`, an SVG and a PNG
 *   whose bytes were cut short all fail there and never reach the network.
 *
 * The placeholders are created in one `LOCAL_ORIGIN` transaction before any
 * upload starts, so the add is one undo step and one broadcast (image.shared),
 * and every upload's result is written with `UPLOAD_ORIGIN`, which no undo
 * history tracks.
 *
 * Retry keeps the `File` in memory (`Map<id, File>`), which is why a page reload
 * takes Retry away and leaves only Remove.
 */

/** The connection states that let an image be added at all. */
export function isOnlineForInsert(state: ConnectionState): boolean {
  return state === "connected" || state === "confirmed";
}

/** What the handlers accept: enough of a drag/clipboard event for board *and* DOM events. */
export interface DropEventLike {
  readonly dataTransfer: DataTransfer | null;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface PasteEventLike {
  readonly clipboardData: DataTransfer | null;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

export interface ImageInsertOptions {
  doc: Y.Doc;
  /** The board the upload goes to. Empty means this tab has no board to write to. */
  boardId: string;
  /** The board's camera, so a drop point in screen pixels becomes a world point. */
  camera: Camera;
  /** Story 3's connection state (`image.offline`). */
  connection: ConnectionState;
  /** Who is adding: the placeholder's `uploaderId`, which decides who sees progress and Retry. */
  identityId: string;
  /** False on a board this tab may not write to (story 4). */
  canEdit?: boolean;
  /** The view the picker's and paste's images are centred in. Defaults to the window. */
  viewportSize?: { width: number; height: number };
  /**
   * Replaces the transport (component tests drive progress and failure by hand).
   * The signature is `uploadImage`'s.
   */
  upload?: (boardId: string, file: File, onProgress: (fraction: number) => void) => UploadHandle;
  /** Called when the picker is closed — files chosen or cancelled — so the tool returns to Select. */
  onPickerClosed?(): void;
}

export interface ImageInsertApi {
  onDragEnter(event: DropEventLike): void;
  /** The board must accept a file drag for a drop to happen at all. */
  onDragOver(event: DropEventLike): void;
  onDragLeave(event: DropEventLike): void;
  onDrop(event: DropEventLike): void;
  onPaste(event: PasteEventLike): void;
  /** The system file picker. Nothing opens while this tab is offline. */
  openPicker(): void;
  /** True while files are over the board (`DropHighlight`). */
  readonly dropActive: boolean;
  /** Upload progress by placeholder id, uploader's own view only. */
  readonly progress: ReadonlyMap<string, number>;
  /** Re-uploads the file this tab still has for `id`. False when it does not. */
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

export function useImageInsert(options: ImageInsertOptions): ImageInsertApi {
  const {
    doc,
    boardId,
    connection,
    identityId,
    canEdit = true,
    upload = uploadImage,
    viewportSize,
    onPickerClosed,
  } = options;

  const boundary = useUndoBoundary();

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dropActive, setDropActive] = useState(false);

  /** The latest values, because every entry point is a long-lived listener. */
  const currentRef = useRef({ doc, boardId, identityId, canEdit, upload, viewportSize, onPickerClosed });
  currentRef.current = { doc, boardId, identityId, canEdit, upload, viewportSize, onPickerClosed };
  const cameraRef = useRef(options.camera);
  cameraRef.current = options.camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  /** `id → File`, the whole of what Retry can do (`image.upload_failure`). */
  const filesRef = useRef(new Map<string, File>());
  const inflightRef = useRef(new Map<string, UploadHandle>());
  /** Whole percentages already reported, so a progress storm is not a render storm. */
  const reportedRef = useRef(new Map<string, number>());
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- progress ----------------------------------------------------------

  const reportProgress = useCallback((id: string, fraction: number) => {
    const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    if (reportedRef.current.get(id) === percent) return;
    reportedRef.current.set(id, percent);
    setProgress((previous) => {
      const next = new Map(previous);
      next.set(id, percent / 100);
      return next;
    });
  }, []);

  const clearProgress = useCallback((id: string) => {
    reportedRef.current.delete(id);
    setProgress((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }, []);

  // ---- one upload, one result -------------------------------------------

  const startUpload = useCallback(
    (id: string, file: File) => {
      const current = currentRef.current;
      const handle = current.upload(current.boardId, file, (fraction) => reportProgress(id, fraction));
      inflightRef.current.set(id, handle);

      void handle.promise.then((result: UploadResult) => {
        if (inflightRef.current.get(id) === handle) inflightRef.current.delete(id);
        clearProgress(id);
        // A placeholder that has been undone or removed in the meantime answers
        // false, which is the whole of what "stale id" means here.
        if (result.kind === "ok") markImageReady(current.doc, id, result.assetKey);
        else markImageFailed(current.doc, id);
      });
    },
    [clearProgress, reportProgress],
  );

  // ---- the flow ----------------------------------------------------------

  const addFiles = useCallback(
    async (files: readonly File[], point: Point, anchor: "top-left" | "centre") => {
      const current = currentRef.current;

      if (!current.canEdit) return;

      // `image.offline`: nothing is created, nothing is uploaded.
      if (!isOnlineForInsert(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const validation = validateFiles(files);
      for (const message of rejectionMessages(validation)) showToast(message);
      if (validation.accepted.length === 0) return;

      // `image.types`, decided by the bytes: the sniffer the Worker uses, then a
      // decode for the file's real pixel dimensions.
      const accepted: Array<{ file: File; contentType: AcceptedImageType; natural: ImageSize }> = [];
      let refusedByContent = false;
      for (const file of validation.accepted) {
        const contentType = await sniffFileContent(file);
        if (contentType === null) {
          refusedByContent = true;
          continue;
        }
        const natural = await naturalPixelSize(file);
        if (natural === null) {
          refusedByContent = true;
          continue;
        }
        accepted.push({ file, contentType, natural });
      }
      if (refusedByContent) showToast(REJECTION_MESSAGES.type);
      if (accepted.length === 0) return;

      // `image.placement_size` and `image.drop`/`image.pick`: each image's final
      // box, in a row, before a single byte is sent.
      const sizes = accepted.map((item) => placementSize(item.natural.width, item.natural.height));
      const rects = layoutRow(sizes, point, anchor);
      const placements: ImagePlacement[] = [];
      const uploadable: File[] = [];
      accepted.forEach((item, index) => {
        const rect = rects[index];
        if (!rect) return;
        placements.push({
          rect,
          naturalWidth: item.natural.width,
          naturalHeight: item.natural.height,
          contentType: item.contentType,
        });
        uploadable.push(item.file);
      });
      if (placements.length === 0) return;

      // One add action is one undo step (`image.shared`, Constraints).
      boundary();
      const ids = createImagePlaceholders(current.doc, placements, current.identityId, Date.now());
      boundary();

      ids.forEach((id, index) => {
        const file = uploadable[index];
        if (!file) return;
        filesRef.current.set(id, file);
        startUpload(id, file);
      });
    },
    [boundary, startUpload],
  );

  // ---- entry points ------------------------------------------------------

  const viewCentre = useCallback((): Point => {
    const size = currentRef.current.viewportSize;
    const width = size?.width ?? (typeof window === "undefined" ? 0 : window.innerWidth);
    const height = size?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight);
    return screenToWorld(cameraRef.current, { x: width / 2, y: height / 2 });
  }, []);

  const onDragEnter = useCallback((event: DropEventLike) => {
    if (!hasFiles(event.dataTransfer)) return;
    dragDepthRef.current += 1;
    setDropActive(true);
  }, []);

  const onDragOver = useCallback((event: DropEventLike) => {
    // A drop only happens where a drag over was accepted; a drag of something
    // that is not files (a board object, selected text) is left alone. Depth is
    // counted by enter/leave alone, because `dragover` fires continuously.
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(true);
  }, []);

  const onDragLeave = useCallback((event: DropEventLike) => {
    if (!hasFiles(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  }, []);

  const onDrop = useCallback(
    (event: DropEventLike) => {
      const files = filesOf(event.dataTransfer);
      dragDepthRef.current = 0;
      setDropActive(false);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      // `image.drop`: the first image's top-left corner goes where it was dropped.
      const point = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
      void addFiles(files, point, "top-left");
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (event: PasteEventLike) => {
      // `image.paste`: while focus is in a field — a note being typed into, a
      // text object, the share link's input — the paste belongs to that field.
      if (isEditableNode(event.target) || isEditableNode(focusOf())) return;
      const files = filesOf(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files, viewCentre(), "centre");
    },
    [addFiles, viewCentre],
  );

  const openPicker = useCallback(() => {
    const current = currentRef.current;
    if (!current.canEdit) return;
    if (!isOnlineForInsert(connectionRef.current)) {
      // The picker stays shut: opening a dialog that can only be disappointed is
      // worse than saying what is wrong.
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const input = ensureFileInput(fileInputRef);
    input.onchange = () => {
      const files = filesOf(input.files);
      input.value = "";
      current.onPickerClosed?.();
      if (files.length > 0) void addFiles(files, viewCentre(), "centre");
    };
    input.oncancel = () => {
      input.value = "";
      current.onPickerClosed?.();
    };
    input.click();
  }, [addFiles, viewCentre]);

  // Paste is on the window: the board does not have to be focused for a screenshot
  // in the clipboard to be worth pasting, and the field check above is what keeps
  // typing in a note a normal paste.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => onPaste(event);
    const drop = (event: DragEvent) => {
      // A file dropped outside the board would otherwise make the browser
      // *navigate to the file*, which loses the board.
      if (event.defaultPrevented) return;
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
    };
    window.addEventListener("paste", paste);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("paste", paste);
      window.removeEventListener("drop", drop);
    };
  }, [onPaste]);

  // An upload that outlives this screen has nowhere to report to.
  useEffect(
    () => () => {
      for (const handle of inflightRef.current.values()) handle.abort();
      inflightRef.current.clear();
      fileInputRef.current?.remove();
      fileInputRef.current = null;
    },
    [],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const current = currentRef.current;
      const file = filesRef.current.get(id);
      if (!file) return false;
      if (!markImageRetrying(current.doc, id, Date.now())) {
        filesRef.current.delete(id);
        return false;
      }
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    dropActive,
    progress,
    retry,
    canRetry,
  };
}

// ---- file and focus helpers -------------------------------------------------

function hasFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  if (typeof dataTransfer.types === "object" && Array.from(dataTransfer.types).includes("Files")) return true;
  return filesOf(dataTransfer).length > 0;
}

function filesOf(source: DataTransfer | FileList | null | undefined): File[] {
  if (!source) return [];
  const list = "files" in source ? source.files : source;
  if (!list || typeof (list as { length?: number }).length !== "number") return [];
  return Array.from(list as ArrayLike<File | null>).filter((file): file is File => Boolean(file));
}

function isEditableNode(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return node.isContentEditable;
}

function focusOf(): Element | null {
  if (typeof document === "undefined") return null;
  return document.activeElement;
}

/** The file's first `IMAGE_SNIFF_BYTES`, judged by the Worker's own sniffer. */
async function sniffFileContent(file: File): Promise<AcceptedImageType | null> {
  try {
    const head = await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer();
    return sniffImageType(new Uint8Array(head));
  } catch {
    return null;
  }
}

/** The file's real pixel dimensions, from the browser's decoder. */
interface Decodeable {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

async function naturalPixelSize(file: File): Promise<ImageSize | null> {
  const decode = (
    globalThis as { createImageBitmap?: (source: Blob) => Promise<Decodeable> }
  ).createImageBitmap;
  if (typeof decode !== "function") return null;
  try {
    const bitmap = await decode(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
    if (size.width <= 0 || size.height <= 0) return null;
    return size;
  } catch {
    return null;
  }
}

/**
 * One hidden input per hook: the picker `image.pick` needs is a real
 * `<input type=file>`, filtered to `IMAGE_ACCEPTED_TYPES` and allowing several
 * files, and the only way to open the system picker is to click one.
 */
function ensureFileInput(ref: { current: HTMLInputElement | null }): HTMLInputElement {
  if (ref.current) return ref.current;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = FILE_PICKER_ACCEPT;
  input.dataset.testid = "image-file-input";
  input.className = "image-file-input";
  document.body.appendChild(input);
  ref.current = input;
  return input;
}
