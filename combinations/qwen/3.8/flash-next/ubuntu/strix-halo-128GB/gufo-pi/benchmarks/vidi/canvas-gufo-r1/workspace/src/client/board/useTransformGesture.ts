import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { type Rect, type Handle, unionRects, resizeRect, clampScale, scaleWithin } from '../../shared/geometry';
import {
  type ObjectSnapshot,
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import { getObjectType } from '../objects/registry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureResult {
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

type GesturePhase = 'idle' | 'pressed' | 'moving' | 'resizing';

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureResult {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const phaseRef = useRef<GesturePhase>('idle');
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const startRectsRef = useRef<Map<string, Rect> | null>(null);
  const startBBoxRef = useRef<Rect | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const scheduleFrame = useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const f = pendingRef.current;
        pendingRef.current = null;
        if (f) f();
      });
    }
  }, []);

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Flush pending on cancel (keep last applied)
      const f = pendingRef.current;
      pendingRef.current = null;
      if (f) f();
    }
  }, []);

  const onObjectPointerDown = useCallback((e: PointerEvent, id: string) => {
    if (!canEditRef.current) return;

    // If the object is not in the selection, select only it
    if (!selectionRef.current.ids.has(id)) {
      selectionRef.current.click(id);
    }

    phaseRef.current = 'pressed';
    startPointRef.current = { x: e.clientX, y: e.clientY };

    const onMove = (moveE: PointerEvent | globalThis.PointerEvent) => {
      if (phaseRef.current === 'idle') return;
      const start = startPointRef.current!;
      const dx = moveE.clientX - start.x;
      const dy = moveE.clientY - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (phaseRef.current === 'pressed') {
        if (dist < DRAG_THRESHOLD_PX) return;
        // Start moving
        phaseRef.current = 'moving';
        onGestureStartRef.current?.();

        // Record start rects for all selected ids
        const sel = selectionRef.current;
        const snap = snapshotRef.current;
        const startRects = new Map<string, Rect>();
        for (const sid of sel.ids) {
          const obj = snap.find((o) => o.id === sid);
          if (obj) startRects.set(sid, objectBounds(obj));
        }
        startRectsRef.current = startRects;

        // Bring to front
        bringObjectsToFront(doc, [...sel.ids]);
      }

      if (phaseRef.current === 'moving') {
        const cam = cameraRef.current;
        const worldDx = dx / cam.zoom;
        const worldDy = dy / cam.zoom;
        const startRects = startRectsRef.current!;

        scheduleFrame(() => {
          const positions = new Map<string, { x: number; y: number }>();
          for (const [objId, rect] of startRects) {
            positions.set(objId, { x: rect.x + worldDx, y: rect.y + worldDy });
          }
          moveObjects(doc, positions);
        });
      }
    };

    const onUp = () => {
      cleanup();
      if (phaseRef.current === 'moving') {
        cancelFrame();
        onGestureEndRef.current?.();
      }
      phaseRef.current = 'idle';
    };

    const onCancel = () => {
      cleanup();
      if (phaseRef.current === 'moving') {
        cancelFrame();
        onGestureEndRef.current?.();
      }
      phaseRef.current = 'idle';
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }, [doc, scheduleFrame, cancelFrame]);

  const onHandlePointerDown = useCallback((e: PointerEvent, handle: Handle) => {
    if (!canEditRef.current) return;

    const sel = selectionRef.current;
    const snap = snapshotRef.current;

    // Check if all selected objects are text (horizontal-only resize)
    let allText = true;
    let anyResizable = false;
    let aspectLocked = false;
    const minSizes: number[] = [];
    const selectedRects: Rect[] = [];

    for (const sid of sel.ids) {
      const obj = snap.find((o) => o.id === sid);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec && spec.resizable) {
        anyResizable = true;
        if (spec.aspectLocked) aspectLocked = true;
        minSizes.push(spec.minSize);
        selectedRects.push(objectBounds(obj));
      }
      if (obj.type !== 'text') allText = false;
    }

    if (!anyResizable) return;

    // If single text object and horizontal handle: use setTextWidthFixed
    if (allText && sel.ids.size === 1 && (handle === 'e' || handle === 'w')) {
      const [id] = [...sel.ids];
      const obj = snap.find((o) => o.id === id);
      if (!obj) return;
      const startBounds = objectBounds(obj);
      phaseRef.current = 'resizing';
      startPointRef.current = { x: e.clientX, y: e.clientY };
      onGestureStartRef.current?.();

      const onMove = (moveE: PointerEvent | globalThis.PointerEvent) => {
        if (phaseRef.current !== 'resizing') return;
        const start = startPointRef.current!;
        const cam = cameraRef.current;
        const worldDx = (moveE.clientX - start.x) / cam.zoom;
        let newWidth: number;
        if (handle === 'e') {
          newWidth = startBounds.width + worldDx;
        } else {
          newWidth = startBounds.width - worldDx;
        }
        setTextWidthFixed(doc, id, newWidth);
      };

      const onUp = () => {
        cleanup();
        onGestureEndRef.current?.();
        phaseRef.current = 'idle';
      };

      const onCancel = () => {
        cleanup();
        onGestureEndRef.current?.();
        phaseRef.current = 'idle';
      };

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      return;
    }

    // If Shift is held, lock aspect
    if (e.shiftKey) aspectLocked = true;

    const bbox = unionRects(selectedRects);
    if (!bbox) return;

    phaseRef.current = 'resizing';
    startPointRef.current = { x: e.clientX, y: e.clientY };
    startBBoxRef.current = bbox;

    // Build a map of start rects keyed by id
    const startRectsMap = new Map<string, Rect>();
    let idx = 0;
    for (const sid of sel.ids) {
      const obj = snap.find((o) => o.id === sid);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec && spec.resizable) {
        startRectsMap.set(sid, objectBounds(obj));
      }
      idx++;
    }

    onGestureStartRef.current?.();

    const onMove = (moveE: PointerEvent | globalThis.PointerEvent) => {
      if (phaseRef.current !== 'resizing') return;
      const start = startPointRef.current!;
      const cam = cameraRef.current;
      const worldDx = (moveE.clientX - start.x) / cam.zoom;
      const worldDy = (moveE.clientY - start.y) / cam.zoom;

      const startBBox = startBBoxRef.current!;
      const newBBox = resizeRect(startBBox, handle, { x: worldDx, y: worldDy }, aspectLocked);

      scheduleFrame(() => {
        // Calculate scale factors
        const scaleX = startBBox.width > 0 ? newBBox.width / startBBox.width : 1;
        const scaleY = startBBox.height > 0 ? newBBox.height / startBBox.height : 1;

        // Clamp scale
        const clampedScale = clampScale(
          { x: scaleX, y: scaleY },
          selectedRects,
          minSizes,
          MAX_OBJECT_SIZE_WORLD,
        );

        // Build the target bbox from the clamped scale (anchored from startBBox)
        // We need to determine the anchor point based on the handle
        const anchor = getAnchorPoint(startBBox, handle);
        const targetBBox: Rect = {
          x: handle === 'w' || handle === 'nw' || handle === 'sw'
            ? anchor.x - startBBox.width * clampedScale.x
            : anchor.x,
          y: handle === 'n' || handle === 'nw' || handle === 'ne'
            ? anchor.y - startBBox.height * clampedScale.y
            : anchor.y,
          width: startBBox.width * clampedScale.x,
          height: startBBox.height * clampedScale.y,
        };

        // Scale each object within from startBBox to targetBBox
        const rects = new Map<string, Rect>();
        for (const [objId, rect] of startRectsMap) {
          rects.set(objId, scaleWithin(rect, startBBox, targetBBox));
        }
        resizeObjects(doc, rects);
      });
    };

    const onUp = () => {
      cleanup();
      cancelFrame();
      onGestureEndRef.current?.();
      phaseRef.current = 'idle';
    };

    const onCancel = () => {
      cleanup();
      cancelFrame();
      onGestureEndRef.current?.();
      phaseRef.current = 'idle';
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }, [doc, scheduleFrame, cancelFrame]);

  return { onObjectPointerDown, onHandlePointerDown };
}

function getAnchorPoint(bbox: Rect, handle: Handle): { x: number; y: number } {
  const left = bbox.x;
  const top = bbox.y;
  const right = bbox.x + bbox.width;
  const bottom = bbox.y + bbox.height;

  switch (handle) {
    case 'se': return { x: left, y: top };
    case 'e': return { x: left, y: top };
    case 's': return { x: left, y: top };
    case 'nw': return { x: right, y: bottom };
    case 'n': return { x: left, y: bottom };
    case 'ne': return { x: left, y: bottom };
    case 'sw': return { x: right, y: top };
    case 'w': return { x: right, y: top };
  }
}
