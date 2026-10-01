import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import {
  createImagePlaceholders, layoutRow, markImageFailed, markImageReady, markImageRetrying, placementSize,
} from '../../shared/objects/image';
import type { UndoController } from '../board/undo';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { uploadImage } from './uploadImage';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';

const HALF = 2;
const MESSAGE_MS = 5000;
const TEXT_EDITOR = 'input, textarea, select, [contenteditable]';
const REJECTION_ORDER: readonly (FileRejection | 'offline')[] = ['type', 'size', 'count', 'offline'];

type Placement = { kind: 'drop'; world: Point } | { kind: 'centre' };

export interface ImageInsert {
  onDragEnter(e: DragEvent): void;
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  /** Upload progress (0..1) of this tab's own uploads. */
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** True while files are dragged over the board. */
  dragActive: boolean;
  /** Refusal messages to show as toasts; they clear themselves. */
  messages: readonly string[];
}

const hasFiles = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types ?? []).includes('Files');

/**
 * Adding images by drop, paste and the file picker: validate, measure, create the placeholders in one undo
 * step, then upload with progress and mark each ready or failed. Nothing is thrown; problems become messages
 * or a failed image. `connection` undefined means a local board without a server.
 */
export function useImageInsert(a: {
  doc: Y.Doc; boardId: string; camera: Camera; connection: ConnectionState | undefined; identityId: string;
  canEdit?: boolean; undo?: UndoController | null; viewCentre?(): Point; getCamera?(): Camera;
}): ImageInsert {
  const latest = useRef(a);
  latest.current = a;
  const currentCamera = (): Camera => latest.current.getCamera?.() ?? latest.current.camera;
  const files = useRef(new Map<string, File>());
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const show = useCallback((kinds: Iterable<FileRejection | 'offline'>) => {
    const set = new Set(kinds);
    const next = REJECTION_ORDER.filter((k) => set.has(k)).map((k) => REJECTION_MESSAGES[k]);
    if (next.length === 0) return;
    setMessages(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessages([]), MESSAGE_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setProgressOf = useCallback((id: string, fraction: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  const startUpload = useCallback((id: string, file: File) => {
    const { doc, boardId } = latest.current;
    setProgressOf(id, 0);
    void uploadImage(boardId, file, (f) => setProgressOf(id, f)).promise.then((result) => {
      setProgressOf(id, null);
      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
        files.current.delete(id);
      } else {
        markImageFailed(doc, id);
      }
    });
  }, [setProgressOf]);

  const addFiles = useCallback(async (list: readonly File[], placement: Placement) => {
    const cur = latest.current;
    if (cur.canEdit === false || list.length === 0) return;
    if (cur.connection !== undefined && cur.connection !== 'connected' && cur.connection !== 'confirmed') {
      show(['offline']);
      return;
    }
    const { accepted, rejections } = validateFiles(list);
    const decoded: { file: File; width: number; height: number }[] = [];
    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        decoded.push({ file, width: bitmap.width, height: bitmap.height });
        bitmap.close?.();
      } catch {
        rejections.add('type');
      }
    }
    show(rejections);
    if (decoded.length === 0) return;
    const sizes = decoded.map((d) => placementSize(d.width, d.height));
    const start = placement.kind === 'drop' ? placement.world
      : (latest.current.viewCentre?.() ?? screenToWorld(currentCamera(), { x: window.innerWidth / HALF, y: window.innerHeight / HALF }));
    const rects = layoutRow(sizes, start, placement.kind === 'drop' ? 'top-left' : 'centre');
    const { doc, identityId, undo } = latest.current;
    undo?.boundary();
    const ids = createImagePlaceholders(doc, decoded.map((d, i) => ({
      rect: rects[i], naturalWidth: d.width, naturalHeight: d.height, contentType: d.file.type,
    })), identityId, Date.now());
    undo?.boundary();
    // Skipped items (non-finite sizes) leave gaps, so match ids back by order of the finite ones.
    const kept = decoded.filter((d, i) => [d.width, d.height, rects[i].x, rects[i].y].every(Number.isFinite));
    ids.forEach((id, i) => {
      files.current.set(id, kept[i].file);
      startUpload(id, kept[i].file);
    });
  }, [show, startUpload]);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDragActive(true);
  }, []);
  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    const into = e.relatedTarget;
    if (into instanceof Node && e.currentTarget instanceof Node && e.currentTarget.contains(into)) return;
    setDragActive(false);
  }, []);
  const onDrop = useCallback((e: DragEvent) => {
    setDragActive(false);
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    const target = e.currentTarget instanceof Element ? e.currentTarget : null;
    const rect = target?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const world = screenToWorld(currentCamera(), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    void addFiles(Array.from(e.dataTransfer?.files ?? []), { kind: 'drop', world });
  }, [addFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    const active = document.activeElement;
    if (target?.closest(TEXT_EDITOR) || active?.closest(TEXT_EDITOR)) return;
    const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    void addFiles(images, { kind: 'centre' });
  }, [addFiles]);

  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;
  useEffect(() => {
    const handler = (e: ClipboardEvent) => onPasteRef.current(e);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);

  // The picker input lives in the document so it can be driven by tests and assistive tools.
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.hidden = true;
    input.tabIndex = -1;
    input.setAttribute('data-testid', 'image-file-input');
    input.setAttribute('aria-label', 'Choose images');
    input.addEventListener('change', () => {
      const chosen = Array.from(input.files ?? []);
      input.value = '';
      void addFilesRef.current(chosen, { kind: 'centre' });
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return () => { input.remove(); inputRef.current = null; };
  }, []);
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  const openPicker = useCallback(() => {
    const cur = latest.current;
    if (cur.canEdit === false) return;
    if (cur.connection !== undefined && cur.connection !== 'connected' && cur.connection !== 'confirmed') {
      show(['offline']);
      return;
    }
    inputRef.current?.click();
  }, [show]);

  const retry = useCallback((id: string): boolean => {
    const file = files.current.get(id);
    if (!file) return false;
    if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
    startUpload(id, file);
    return true;
  }, [startUpload]);
  const canRetry = useCallback((id: string): boolean => files.current.has(id), []);

  return {
    onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, progress, retry, canRetry, dragActive, messages,
  };
}
