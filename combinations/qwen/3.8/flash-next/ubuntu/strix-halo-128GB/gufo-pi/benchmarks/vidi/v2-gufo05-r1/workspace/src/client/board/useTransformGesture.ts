/**
 * The board's one pointer gesture at a time: move the selection, or resize it
 * (`sel.group_move`, `sel.drag_unselected`, `sel.resize`, `sel.aspect`,
 * `sel.size_limits`).
 *
 * It lives above the objects rather than inside each of them because the thing being
 * dragged is a *selection*: pressing a note that is one of six moves all six, and
 * dragging a handle resizes every object in the selection from the opposite corner.
 * So the objects report their presses here, and the resize handles on the selection
 * outline call into it directly.
 *
 * One gesture at a time, and the state machine is:
 *
 *   Idle ──pointerdown──▶ Pressed ──move ≥ DRAG_THRESHOLD_PX──▶ Moving | Resizing
 *                           └─pointerup─▶ Idle      └─up / cancel──▶ Idle
 *
 * Under the threshold a press is a click: it selects, and writes nothing. Past it the
 * gesture writes in world units through the generic model operations, so a move and a
 * resize reach everybody else the way any other change does (`sync.*`), and the
 * positions it applies are absolute — computed from where each object was when the
 * press began, never from where it was last frame — so two people dragging the same
 * object both end up where the document says they do (story 2's `sticky.drag` rule,
 * and story 3's TC-24, hold for a group drag for the same reason).
 *
 * Writes are throttled to one per animation frame, as story 2 throttled a note drag,
 * so a fast mouse cannot fill the document with positions nobody saw.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
} from '../../shared/board-model';
import {
  anchoredRect,
  clampScale,
  resizeRect,
  scaleWithin,
  type HandleId,
  type Rect,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionHandle } from './useSelection';

/** Parameters as passed by `App`, held in a ref so a gesture never sees stale values. */
export interface TransformGestureParams {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionHandle;
  /** What the board can draw, not just what the document holds. */
  snapshot: readonly ObjectSnapshot[];
  /** False when the document failed to load: selecting works, this does not. */
  canEdit: boolean;
}

export interface TransformGestureHandlers {
  /** Press on an object: select it, and drag the whole selection if it may move. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Press on one of the eight handles of the selection's bounding box. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: HandleId): void;
  /** True while a move or resize is in progress: toolbars and outlines hide. */
  isTransforming: boolean;
}

/**
 * What one object contributes to a press: where it was when the press began, and what
 * the registry says may be done to it. Read once, at the press, so the gesture keeps
 * working from a consistent picture even as the document moves underneath it.
 */
interface PressItem {
  id: string;
  /** Every position and size the gesture applies is derived from this rectangle. */
  rect: Rect;
  minSize: number;
  resizable: boolean;
  aspectLocked: boolean;
}

/** A press, of either kind, and how far it has got. */
interface Press {
  pointerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  items: PressItem[];
  /** Set when the press is on a resize handle: the bounding box and which handle. */
  resize: { handle: HandleId; box: Rect; aspect: boolean } | null;
  /** Has the threshold been crossed? */
  moving: boolean;
  /**
   * A press that started on an object already inside a larger selection: if it ends
   * without moving, it was a click, and a click on one object of a group means "this
   * one" (`sel.click`). While it moves, the group moves with it (`sel.group_move`).
   */
  narrowTo: string | null;
  /** Pending animation frame, so writes are throttled to one per frame. */
  frame: number | null;
}

/** Read the selected objects out of the snapshot, with their capabilities. */
function pressItems(snapshot: readonly ObjectSnapshot[], ids: readonly string[]): PressItem[] {
  const items: PressItem[] = [];
  for (const id of ids) {
    const object = snapshot.find((candidate) => candidate.id === id);
    if (!object) continue; // deleted between the render and the press
    const spec = getObjectType(object.type);
    items.push({
      id,
      rect: objectBounds(object),
      minSize: spec?.minSize ?? 1,
      resizable: spec?.resizable ?? false,
      aspectLocked: spec?.aspectLocked ?? false,
    });
  }
  return items;
}

/** The box that encloses a set of rectangles, or null when there is nothing to bound. */
function boundingBox(items: readonly PressItem[]): Rect | null {
  if (items.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    left = Math.min(left, item.rect.x);
    top = Math.min(top, item.rect.y);
    right = Math.max(right, item.rect.x + item.rect.width);
    bottom = Math.max(bottom, item.rect.y + item.rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where a press began, before we know whether it will move anything. */
function pressAt(event: ReactPointerEvent<HTMLElement>, items: PressItem[], press?: Partial<Press>): Press {
  return {
    pointerId: event.pointerId,
    fromX: event.clientX,
    fromY: event.clientY,
    toX: event.clientX,
    toY: event.clientY,
    items,
    resize: null,
    moving: false,
    narrowTo: null,
    frame: null,
    ...press,
  };
}

/** One press, followed on `window` until it ends. */
export function useTransformGesture(params: TransformGestureParams): TransformGestureHandlers {
  /** Latest props, so a gesture that outlives a render still sees the real board. */
  const latest = useRef(params);
  latest.current = params;
  const pressRef = useRef<Press | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);

  /** The one place a gesture's writes happen, for a move and a resize alike. */
  const apply = useCallback((press: Press): void => {
    const { doc, camera } = latest.current;
    const zoom = camera.zoom || 1;
    const dx = (press.toX - press.fromX) / zoom;
    const dy = (press.toY - press.fromY) / zoom;

    if (!press.resize) {
      // Every object moves by the same distance, from where it was at the press: the
      // arrangement inside the selection is exactly kept (`sel.group_move`).
      const positions = new Map<string, Point>();
      for (const item of press.items) {
        positions.set(item.id, { x: item.rect.x + dx, y: item.rect.y + dy });
      }
      moveObjects(doc, positions);
      return;
    }

    const { handle, box, aspect } = press.resize;
    const target = resizeRect(box, handle, { x: dx, y: dy }, aspect);
    // How far the box wants to grow, and then how far it may: the whole selection
    // stops at the scale where its first object hits a limit (`sel.size_limits`).
    const scale = clampScale(
      {
        x: box.width === 0 ? 1 : target.width / box.width,
        y: box.height === 0 ? 1 : target.height / box.height,
      },
      press.items.map((item) => item.rect),
      press.items.map((item) => item.minSize),
      MAX_OBJECT_SIZE_WORLD,
    );
    const to = anchoredRect(box, handle, box.width * scale.x, box.height * scale.y);
    const rects = new Map<string, Rect>();
    for (const item of press.items) {
      // Where this object sits within the box, scaled with it: the gap between two
      // notes grows in the same proportion as the notes themselves.
      rects.set(item.id, scaleWithin(item.rect, box, to));
    }
    resizeObjects(doc, rects);
  }, []);

  /** Cross the threshold: announce the gesture, raise the objects, then follow. */
  const startMoving = useCallback(
    (press: Press): void => {
      press.moving = true;
      // From here the board is transforming: the bar and the outlines get out of the
      // way, and the cursor says `grabbing`. It is said here rather than at the press,
      // so that a click — which never moves anything — does not flash it.
      setIsTransforming(true);
      // Moving a selection lifts it above what is not selected, keeping the order
      // among itself (`sel.group_move`). A resize raises nothing.
      if (!press.resize) bringObjectsToFront(latest.current.doc, press.items.map((item) => item.id));
    },
    [],
  );

  /** The pointer is up: land the last position, and let go. Exactly once. */
  const end = useCallback(
    (press: Press, cancelled: boolean): void => {
      if (press.frame !== null) {
        cancelAnimationFrame(press.frame);
        press.frame = null;
      }
      // A drag ends exactly under the pointer; an interrupted one keeps the position
      // it was last shown at (`sticky.drag`, TC-21).
      if (press.moving && !cancelled) apply(press);
      // A press on one member of a group that never moved was a click on it, so the
      // group is no longer the selection. An interrupted press changes nothing.
      if (!cancelled && !press.moving && press.narrowTo) {
        latest.current.selection.click(press.narrowTo);
      }
      if (pressRef.current === press) {
        pressRef.current = null;
        setIsTransforming(false);
      }
    },
    [apply],
  );

  const follow = useCallback(
    (event: PointerEvent, press: Press): void => {
      if (event.pointerId !== press.pointerId) return;
      press.toX = event.clientX;
      press.toY = event.clientY;
      if (!press.moving) {
        const distance = Math.hypot(press.toX - press.fromX, press.toY - press.fromY);
        if (distance < DRAG_THRESHOLD_PX) return;
        startMoving(press);
      }
      if (press.frame !== null) return; // one write per animation frame
      if (typeof requestAnimationFrame === 'function') {
        press.frame = requestAnimationFrame(() => {
          press.frame = null;
          if (pressRef.current === press) apply(press);
        });
      } else {
        apply(press); // jsdom and hidden tabs
      }
    },
    [apply, startMoving],
  );

  /** Take the press, then follow it on `window` until it is over. */
  const run = useCallback(
    (event: ReactPointerEvent<HTMLElement>, press: Press): void => {
      // One gesture at a time: a second pointer does not start another one.
      if (pressRef.current) return;
      pressRef.current = press;
      // Followed on `window`, not on the element: bringing objects to the front moves
      // their DOM nodes, which drops pointer capture, and the pointer regularly leaves
      // the object that started the press.
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // Best effort: the window listeners below drive the gesture regardless.
      }

      const stop = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      const onMove = (moveEvent: PointerEvent) => {
        if (pressRef.current === press) follow(moveEvent, press);
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== press.pointerId || pressRef.current !== press) return;
        stop();
        end(press, false);
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== press.pointerId || pressRef.current !== press) return;
        stop();
        end(press, true);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [end, follow],
  );

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string): void => {
      if (event.button !== 0) return;
      const { selection, snapshot } = latest.current;

      // Selecting is always allowed — even on a board that failed to load, where the
      // user can still look at what is there — and it happens at the press, so a click
      // and a drag both select (`sel.click`, `sel.shift_toggle`).
      //
      // What gets dragged is decided here, not read back from the selection: a
      // dispatch above has not taken effect yet in this render, and a press on an
      // unselected object must still drag the object it just selected
      // (`sel.drag_unselected`). Otherwise the whole selection goes with it
      // (`sel.group_move`).
      let ids: string[];
      let narrowTo: string | null = null;
      if (event.shiftKey) {
        selection.toggle(id);
        // Shift-click drags only the object under the pointer, so that adding to a
        // selection and moving one object are not the same gesture.
        ids = [id];
      } else if (selection.has(id)) {
        ids = [...selection.ids];
        // Keep the group for now; if this press turns out to be a click rather than a
        // drag, it narrows to this object when the pointer comes up.
        narrowTo = ids.length > 1 ? id : null;
      } else {
        selection.click(id);
        ids = [id];
      }

      if (!latest.current.canEdit) return; // nothing here may be written
      const items = pressItems(snapshot, ids);
      if (items.length === 0) return;
      run(event, pressAt(event, items, { narrowTo }));
    },
    [run],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, handle: HandleId): void => {
      if (event.button !== 0) return;
      const { selection, snapshot, canEdit } = latest.current;
      if (!canEdit) return;
      // An object whose type cannot be resized takes no part in a resize; if nothing
      // in the selection can be, the handles do nothing.
      const items = pressItems(snapshot, [...selection.ids]).filter((item) => item.resizable);
      if (items.length === 0) return;
      const box = boundingBox(items);
      if (!box) return;
      run(
        event,
        pressAt(event, items, {
          // A type that keeps its proportions locks the resize for the whole
          // selection; so does holding Shift (`sel.aspect`).
          resize: {
            handle,
            box,
            aspect: items.some((item) => item.aspectLocked) || event.shiftKey,
          },
        }),
      );
    },
    [run],
  );

  return { onObjectPointerDown, onHandlePointerDown, isTransforming };
}
