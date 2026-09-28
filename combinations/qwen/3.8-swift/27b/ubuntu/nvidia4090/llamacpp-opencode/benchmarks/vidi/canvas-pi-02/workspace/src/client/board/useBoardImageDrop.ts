// Drag-and-drop and clipboard-paste entry points for images (story 12,
// image.drop / image.paste). One hook attaches the listeners to the board
// root:
//
//  - dragenter/dragover with Files → highlight; drop → onDrop(files, point)
//    with the viewport-local screen point (clientX/Y minus the board rect).
//  - window 'paste' with image files → onPaste(files).
//
// The drop point is delivered in the same coordinate space BoardPage's
// camera helpers use (viewport-local CSS px), so insertion is
// `screenToWorld(camera, point)` — the image lands where it was dropped
// (image.drop: "the image lands where it was dropped").

import { useEffect, useRef, useState } from 'react';

export interface BoardDropApi {
  /** True while image files are being dragged over the board. */
  dragging: boolean;
  /** The React listeners to spread onto the board root element. */
  handlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

interface Options {
  /** Image files dropped, with the viewport-local screen drop point. */
  onDrop: (files: File[], point: { x: number; y: number }) => void;
  /** Image files pasted from the clipboard. */
  onPaste: (files: File[]) => void;
  /** The board root element (for the drop-point rect). */
  getRootEl: () => HTMLDivElement | null;
}

function eventHasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function useBoardImageDrop(options: Options): BoardDropApi {
  const [dragging, setDragging] = useState(false);
  const depthRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Pass ALL files: validateFiles in the insertion hook decides what is
      // an image and toasts the rejections (image.types). Pre-filtering here
      // would silently drop invalid types.
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      optionsRef.current.onPaste(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setDragging(false);
      // Pass ALL dropped files: validateFiles in the insertion hook decides
      // what is an image and toasts the rejections (image.types).
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const root = optionsRef.current.getRootEl();
      const rect = root?.getBoundingClientRect();
      const point =
        rect !== undefined
          ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
          : { x: 0, y: 0 };
      optionsRef.current.onDrop(files, point);
    },
  };

  return { dragging, handlers };
}
