// Story 12: the drop, paste and picker flows. Owns the in-memory file map
// (for Retry after a failed upload), per-object upload progress, the
// rejection/offline toast, and the ImageController the ImageObject render
// states read through context.

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  layoutRow,
  placementSize,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES, IMAGE_LAYOUT_GAP_WORLD } from '../../shared/config';
import { deleteObjects } from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import type { ViewportHandle } from '../canvas/BoardViewport';
import type { ConnectionState } from '../sync/connectBoard';
import type { UndoController } from '../board/undo';
import { getIdentity } from '../identity/identity';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';

const TOAST_DISMISS_MS = 5000;

// What an ImageObject needs from the inserting tab: live upload progress,
// whether the file is still in memory (Retry availability), the Retry/Remove
// actions and a shared clock for the stale-upload derivation.
export interface ImageController {
  progressFor(id: string): number | null;
  hasFile(id: string): boolean;
  retry(id: string): void;
  remove(id: string): void;
  now(): number;
}

export const ImageControllerContext = createContext<ImageController | null>(null);

export interface UseImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  connection: ConnectionState;
  canEdit(): boolean;
  getViewport(): ViewportHandle | null;
  undo: UndoController;
  isTextEditing(): boolean;
}

export interface ImageInsert {
  controller: ImageController;
  toast: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  openPicker(): void;
  addFilesAtPoint(files: readonly File[], world: Point): void;
  onFilesChosen(e: React.ChangeEvent<HTMLInputElement>): void;
}

function isOnline(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function messagesFor(rejections: Set<'type' | 'size' | 'count'>): string[] {
  const out: string[] = [];
  if (rejections.has('type')) out.push(REJECTION_MESSAGES.type);
  if (rejections.has('size')) out.push(REJECTION_MESSAGES.size);
  if (rejections.has('count')) out.push(REJECTION_MESSAGES.count);
  return out;
}

export function useImageInsert(opts: UseImageInsertOptions): ImageInsert {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const filesRef = useRef(new Map<string, File>());
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((messages: string[]) => {
    if (messages.length === 0) return;
    setToast([...new Set(messages)].join('\n'));
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  const startUpload = useCallback((id: string, file: File) => {
    const o = optsRef.current;
    setProgress((prev) => {
      const next = new Map(prev);
      next.set(id, 0);
      return next;
    });
    uploadImage(o.boardId, file, (percent) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(id, percent);
        return next;
      });
    })
      .then((result) => {
        markImageReady(o.doc, id, result.assetKey, result.contentType);
      })
      .catch(() => {
        markImageFailed(o.doc, id);
      })
      .finally(() => {
        setProgress((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });
  }, []);

  // The shared entry point for all three flows. `centre` places the row
  // centred in the visible area (paste/picker); otherwise the first image's
  // top-left lands on `world` and the row runs right (drop).
  const addFiles = useCallback(
    (files: readonly File[], world: Point | null) => {
      const o = optsRef.current;
      if (!o.canEdit() || !isOnline(o.connection)) {
        showToast([REJECTION_MESSAGES.offline]);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      const messages = messagesFor(rejections);
      if (accepted.length === 0) {
        showToast(messages);
        return;
      }
      void (async () => {
        const decoded: { file: File; width: number; height: number }[] = [];
        let decodeFailed = false;
        for (const file of accepted) {
          try {
            const bitmap = await createImageBitmap(file);
            decoded.push({ file, width: bitmap.width, height: bitmap.height });
            bitmap.close();
          } catch {
            // A file whose bytes are not a decodable image is refused by
            // content, like the server would (image.types).
            decodeFailed = true;
          }
        }
        if (decodeFailed) messages.push(REJECTION_MESSAGES.type);
        if (decoded.length === 0) {
          showToast(messages);
          return;
        }
        const sizes = decoded.map((d) => placementSize(d.width, d.height));
        let anchor: Point;
        if (world !== null) {
          anchor = world;
        } else {
          const viewport = o.getViewport();
          const centre = viewport ? viewport.centerWorld() : { x: 0, y: 0 };
          const rowWidth =
            sizes.reduce((sum, s) => sum + s.width, 0) +
            (sizes.length - 1) * IMAGE_LAYOUT_GAP_WORLD;
          const tallest = Math.max(...sizes.map((s) => s.height));
          anchor = { x: centre.x - rowWidth / 2, y: centre.y - tallest / 2 };
        }
        const positions = layoutRow(sizes, anchor);
        o.undo.boundary(); // one undo step per add (image.undo)
        const ids = createImagePlaceholders(
          o.doc,
          decoded.map((d, i) => ({
            x: positions[i].x,
            y: positions[i].y,
            width: sizes[i].width,
            height: sizes[i].height,
            contentType: d.file.type,
            naturalWidth: d.width,
            naturalHeight: d.height,
          })),
          getIdentity().id,
        );
        ids.forEach((id, i) => {
          filesRef.current.set(id, decoded[i].file);
          startUpload(id, decoded[i].file);
        });
        o.undo.boundary();
        if (messages.length > 0) showToast(messages);
      })();
    },
    [showToast, startUpload],
  );

  const addFilesAtPoint = useCallback(
    (files: readonly File[], world: Point) => {
      addFiles(files, world);
    },
    [addFiles],
  );

  const openPicker = useCallback(() => {
    const o = optsRef.current;
    if (!o.canEdit() || !isOnline(o.connection)) {
      showToast([REJECTION_MESSAGES.offline]);
      return;
    }
    inputRef.current?.click();
  }, [showToast]);

  const onFilesChosen = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? [...e.target.files] : [];
      e.target.value = '';
      addFiles(files, null);
    },
    [addFiles],
  );

  // Paste: only when the board (not a text editor) has focus and the
  // clipboard actually carries image files.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const o = optsRef.current;
      if (o.isTextEditing() || isTextTarget(e.target)) return;
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      if (![...files].some((f) => f.type.startsWith('image/'))) return;
      e.preventDefault();
      addFiles([...files], null);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const controller = useMemo<ImageController>(
    () => ({
      progressFor: (id) => progress.get(id) ?? null,
      hasFile: (id) => filesRef.current.has(id),
      retry: (id) => {
        const file = filesRef.current.get(id);
        if (file === undefined) return;
        markImageRetrying(optsRef.current.doc, id);
        startUpload(id, file);
      },
      remove: (id) => {
        filesRef.current.delete(id);
        const o = optsRef.current;
        o.undo.boundary();
        deleteObjects(o.doc, [id]);
        o.undo.boundary();
      },
      now: () => Date.now(),
    }),
    [progress, startUpload],
  );

  return { controller, toast, inputRef, openPicker, addFilesAtPoint, onFilesChosen };
}

export const IMAGE_PICKER_ACCEPT = IMAGE_ACCEPTED_TYPES.join(',');
