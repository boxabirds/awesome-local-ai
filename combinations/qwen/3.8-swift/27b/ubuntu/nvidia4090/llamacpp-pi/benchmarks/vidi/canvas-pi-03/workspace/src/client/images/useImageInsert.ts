/**
 * Story 12: image insertion (image.drop / image.paste / image.pick).
 *
 * One hook, three entry points — drop, paste and the file picker — all
 * funnel into `processFiles`:
 *   1. offline gate: the connection must be `connected`/`confirmed`, else
 *      the offline toast and nothing more (image.offline);
 *   2. validateFiles: count/type/size rules, one toast per reason (image.insert);
 *   3. measure every accepted file with `createImageBitmap` (decode failure
 *      → the type toast, no placeholder);
 *   4. ONE placeholder transaction (one undo step for the whole action);
 *   5. upload each file in the background; progress on the uploader's
 *      placeholder; completion → `ready` + assetKey; 429 → `failed` + rate
 *      toast; 415 → `failed` + type toast (the server sniff wins over the
 *      client header); other failures → `failed`.
 *
 * Retry keeps the File in memory (per uploader tab) and re-uploads a failed
 * image; after a tab reload the file is gone and only Remove is offered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
} from 'src/shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from 'src/shared/config';
import { showToast } from '../ui/Toast';

export interface ImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  viewSize: { width: number; height: number };
  connection: ConnectionState;
  identityId: string;
  /** Undo boundary: one add action is exactly one undo step (story 8). */
  boundary(): void;
}

export interface ImageInsert {
  onDragEnter(e: React.DragEvent): void;
  onDragOver(e: React.DragEvent): void;
  onDragLeave(e: React.DragEvent): void;
  onDrop(e: React.DragEvent): void;
  onPaste(e: { clipboardData: DataTransfer | null; preventDefault(): void }): void;
  openPicker(): void;
  /** Feeds files to the insert flow centred on the visible area (picker). */
  addFiles(files: readonly File[]): void;
  /** True while file drags hover the board (the dashed drop highlight). */
  dragActive: boolean;
  /** Upload progress fractions (0..1) keyed by image id. */
  progress: ReadonlyMap<string, number>;
  /** Re-uploads a failed image whose File is still in memory. */
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

function isOnline(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

export function useImageInsert(opts: ImageInsertOptions): ImageInsert {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const filesRef = useRef(new Map<string, File>());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Measure the natural size of a file; null on decode failure.
  const measure = useCallback(async (file: File): Promise<{ width: number; height: number } | null> => {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    }
  }, []);

  const uploadOne = useCallback(
    (id: string, file: File): void => {
      const { doc } = optsRef.current;
      filesRef.current.set(id, file);
      const handle = uploadImage(optsRef.current.boardId, file, (fraction) => {
        setProgress((p) => {
          const next = new Map(p);
          next.set(id, fraction);
          return next;
        });
      });
      void handle.promise.then((result) => {
        setProgress((p) => {
          if (!p.has(id)) return p;
          const next = new Map(p);
          next.delete(id);
          return next;
        });
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else if (result.kind === 'rate_limited') {
          markImageFailed(doc, id);
          showToast(REJECTION_MESSAGES.rate);
        } else if (result.status === 415) {
          // The server sniff rejected the content (forged header / disguised
          // file): surface it as the unsupported-type message.
          markImageFailed(doc, id);
          showToast(REJECTION_MESSAGES.type);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [],
  );

  /** The shared insert flow: validate → measure → placeholders → uploads. */
  const processFiles = useCallback(
    async (files: readonly File[], world: { x: number; y: number }, anchor: 'top-left' | 'centre'): Promise<void> => {
      const { doc, boundary } = optsRef.current;
      if (!isOnline(optsRef.current.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const reason of rejections) showToast(REJECTION_MESSAGES[reason]);
      if (accepted.length === 0) return;

      const measured: Array<{ file: File; width: number; height: number }> = [];
      let decodeFailed = false;
      for (const file of accepted) {
        const size = await measure(file);
        if (size === null) {
          decodeFailed = true;
          continue;
        }
        measured.push({ file, ...size });
      }
      if (decodeFailed) showToast(REJECTION_MESSAGES.type);
      if (measured.length === 0) return;

      const sizes = measured.map((m) => placementSize(m.width, m.height));
      const rects = layoutRow(sizes, world, anchor);
      boundary();
      const ids = createImagePlaceholders(
        doc,
        measured.map((m, i) => ({
          rect: rects[i],
          naturalWidth: m.width,
          naturalHeight: m.height,
          contentType: m.file.type,
        })),
        optsRef.current.identityId,
        Date.now(),
      );
      boundary();
      ids.forEach((id, i) => uploadOne(id, measured[i].file));
    },
    [measure, uploadOne],
  );

  const hasFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return;
    // Drop must be allowed for the browser to fire it.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const world = screenToWorld(optsRef.current.camera, { x: e.clientX, y: e.clientY });
      void processFiles(files, world, 'top-left');
    },
    [processFiles],
  );

  const onPaste = useCallback(
    (e: { clipboardData: DataTransfer | null; preventDefault(): void }): void => {
      const target = document.activeElement;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return; // typing in a text control — the paste belongs to it
      }
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(f.type),
      );
      if (files.length === 0) return; // non-image clipboard content: ignored
      e.preventDefault();
      const { camera, viewSize } = optsRef.current;
      const world = screenToWorld(camera, { x: viewSize.width / 2, y: viewSize.height / 2 });
      void processFiles(files, world, 'centre');
    },
    [processFiles],
  );

  // Window-level paste listener (document-level: any focus works).
  useEffect(() => {
    const listener = (e: Event): void => onPasteRef.current(e as ClipboardEvent);
    window.addEventListener('paste', listener);
    return () => window.removeEventListener('paste', listener);
  }, []);
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;

  const openPicker = useCallback((): void => {
    if (!isOnline(optsRef.current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.setAttribute('data-testid', 'image-file-input');
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length > 0) {
          const { camera, viewSize } = optsRef.current;
          const world = screenToWorld(camera, { x: viewSize.width / 2, y: viewSize.height / 2 });
          void processFiles(files, world, 'centre');
        }
      });
      inputRef.current = input;
      document.body.appendChild(input);
    }
    inputRef.current.click();
  }, [processFiles]);

  const addFiles = useCallback(
    (files: readonly File[]): void => {
      const { camera, viewSize } = optsRef.current;
      const world = screenToWorld(camera, { x: viewSize.width / 2, y: viewSize.height / 2 });
      void processFiles(files, world, 'centre');
    },
    [processFiles],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (!file) return false;
      if (!markImageRetrying(optsRef.current.doc, id, Date.now())) return false;
      uploadOne(id, file);
      return true;
    },
    [uploadOne],
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    addFiles,
    dragActive,
    progress,
    retry,
    canRetry,
  };
}
