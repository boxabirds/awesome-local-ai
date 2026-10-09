import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import * as Y from 'yjs';
import { createImagePlaceholders, layoutRow, markImageFailed, markImageReady, markImageRetrying, placementSize, type PlaceholderItem } from '../../shared/objects/image';
import type { Point } from '../../shared/geometry';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { getSessionId } from '../session';
import type { ConnectionState } from '../sync/connectBoard';
import { useUndoController } from '../board/useUndo';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';
import type { ToastMessage } from './Toast';

const TOAST_DISMISS_MS = 5000;
const TOAST_ORDER: readonly ('count' | 'type' | 'size')[] = ['count', 'type', 'size'];

export interface UseImageInsertArgs {
  doc: Y.Doc | undefined;
  boardId: string | undefined;
  connection: ConnectionState;
  canEdit: boolean;
  // World point at the centre of the current view (picker and paste anchors).
  getCentreWorld(): Point;
}

export interface ImageInsertApi {
  addFiles(files: readonly File[], world: Point, anchor: 'top-left' | 'centre'): void;
  openPicker(): void;
  retry(id: string): void;
  canRetry(id: string): boolean;
  getProgress(id: string): number | null;
  toasts: readonly ToastMessage[];
  fileInputProps: {
    ref: RefObject<HTMLInputElement | null>;
    type: 'file';
    multiple: boolean;
    accept: string;
    hidden: boolean;
    tabIndex: number;
    'aria-hidden': boolean;
    onChange(event: ChangeEvent<HTMLInputElement>): void;
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as HTMLElement;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable === true;
}

function decodeNaturalSize(file: File): Promise<{ width: number; height: number }> {
  const impl = (globalThis as { createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?(): void }> }).createImageBitmap;
  if (typeof impl !== 'function') return Promise.reject(new Error('createImageBitmap unavailable'));
  return impl(file).then((bitmap) => {
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  });
}

// Whole image-add pipeline for one session (design image.insert): validate,
// decode natural sizes, place a row of placeholders as one undo step, then
// upload in parallel with progress. Status writes are UPLOAD_ORIGIN, so
// uploads never pollute the undo stack. The File stays in memory for Retry
// and is deliberately lost on reload.
export function useImageInsert(args: UseImageInsertArgs): ImageInsertApi {
  const docRef = useRef(args.doc);
  docRef.current = args.doc;
  const boardIdRef = useRef(args.boardId);
  boardIdRef.current = args.boardId;
  const connectionRef = useRef(args.connection);
  connectionRef.current = args.connection;
  const canEditRef = useRef(args.canEdit);
  canEditRef.current = args.canEdit;
  const getCentreWorldRef = useRef(args.getCentreWorld);
  getCentreWorldRef.current = args.getCentreWorld;
  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const filesRef = useRef(new Map<string, File>());
  const handlesRef = useRef(new Map<string, UploadHandle>());
  const progressRef = useRef(new Map<string, number>());
  const [, bumpProgress] = useReducer((value: number) => value + 1, 0);

  const pushToast = useCallback(
    (message: string): void => {
      const id = (toastSeq.current += 1);
      setToasts((current) => [...current, { id, message }]);
      toastTimers.current.set(
        id,
        setTimeout(() => {
          toastTimers.current.delete(id);
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }, TOAST_DISMISS_MS)
      );
    },
    []
  );

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
      for (const handle of handlesRef.current.values()) handle.abort();
      handlesRef.current.clear();
    },
    []
  );

  const setProgress = useCallback(
    (id: string, fraction: number): void => {
      progressRef.current.set(id, fraction);
      bumpProgress();
    },
    []
  );

  const getProgress = useCallback((id: string): number | null => progressRef.current.get(id) ?? null, []);
  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  const uploadOne = useCallback(
    (id: string, file: File): void => {
      const doc = docRef.current;
      const boardId = boardIdRef.current;
      if (doc === undefined || boardId === undefined) return;
      setProgress(id, 0);
      const handle = uploadImage(boardId, file, {
        onProgress: (fraction) => setProgress(id, fraction),
        onDone: (result) => {
          handlesRef.current.delete(id);
          progressRef.current.delete(id);
          bumpProgress();
          if (result.ok) markImageReady(doc, id, result.assetKey);
          else markImageFailed(doc, id);
        }
      });
      handlesRef.current.set(id, handle);
    },
    [setProgress]
  );

  const addFiles = useCallback(
    (files: readonly File[], world: Point, anchor: 'top-left' | 'centre'): void => {
      const doc = docRef.current;
      if (doc === undefined || !canEditRef.current) return;
      if (connectionRef.current !== 'connected' && connectionRef.current !== 'confirmed') {
        pushToast(REJECTION_MESSAGES.offline);
        return;
      }
      if (files.length === 0) return;
      const { accepted, rejections } = validateFiles(files);
      for (const kind of TOAST_ORDER) {
        if (rejections.has(kind)) pushToast(REJECTION_MESSAGES[kind]);
      }
      if (accepted.length === 0) return;
      void (async () => {
        const decodes = await Promise.all(accepted.map((file) => decodeNaturalSize(file).then(
          (size) => ({ file, size }),
          (): { file: File; size: null } => ({ file, size: null })
        )));
        const usable = decodes.filter((entry) => entry.size !== null);
        if (usable.length < decodes.length) pushToast(REJECTION_MESSAGES.type);
        if (usable.length === 0) return;
        const sizes = usable.map((entry) => placementSize(entry.size.width, entry.size.height));
        const rects = layoutRow(sizes, world, anchor);
        const items: PlaceholderItem[] = usable.map((entry, index) => ({
          rect: rects[index] as (typeof rects)[number],
          naturalWidth: entry.size.width,
          naturalHeight: entry.size.height,
          contentType: entry.file.type
        }));
        const currentDoc = docRef.current;
        if (currentDoc === undefined) return;
        undoRef.current?.boundary();
        const ids = createImagePlaceholders(currentDoc, items, getSessionId(), Date.now());
        undoRef.current?.boundary();
        ids.forEach((id, index) => {
          const entry = usable[index];
          if (entry === undefined) return;
          filesRef.current.set(id, entry.file);
          uploadOne(id, entry.file);
        });
      })();
    },
    [pushToast, uploadOne]
  );

  const retry = useCallback(
    (id: string): void => {
      const file = filesRef.current.get(id);
      const doc = docRef.current;
      if (file === undefined || doc === undefined) return;
      markImageRetrying(doc, id, Date.now());
      uploadOne(id, file);
    },
    [uploadOne]
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openPicker = useCallback((): void => {
    if (connectionRef.current !== 'connected' && connectionRef.current !== 'confirmed') {
      pushToast(REJECTION_MESSAGES.offline);
      return;
    }
    fileInputRef.current?.click();
  }, [pushToast]);

  const fileInputProps = {
    ref: fileInputRef,
    type: 'file' as const,
    multiple: true,
    accept: IMAGE_ACCEPTED_TYPES.join(','),
    hidden: true,
    tabIndex: -1,
    'aria-hidden': true,
    onChange: (event: ChangeEvent<HTMLInputElement>): void => {
      const picked = Array.from(event.target.files ?? []);
      event.target.value = '';
      addFiles(picked, getCentreWorldRef.current(), 'centre');
    }
  };

  // Paste: only when focus is not in a text field and the clipboard actually
  // carries image files, so pasted text keeps working everywhere.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const clipboard = event.clipboardData;
      if (clipboard === null || clipboard.files.length === 0) return;
      const images = Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) return;
      event.preventDefault();
      addFiles(images, getCentreWorldRef.current(), 'centre');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  return { addFiles, openPicker, retry, canRetry, getProgress, toasts, fileInputProps };
}
