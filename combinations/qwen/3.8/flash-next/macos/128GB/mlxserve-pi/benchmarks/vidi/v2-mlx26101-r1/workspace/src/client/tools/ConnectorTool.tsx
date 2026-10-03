// The Connector tool (story 10, connector.*): hold it and the objects on the board grow
// dots; drag from a dot to a dot and an arrow ties them together; let go over empty board
// and nothing happens; one Escape puts the tool down.
//
// It owns two gestures and no others:
//
//  - starting an arrow, from an object's side dot (an arrow that starts on nothing is not
//    written at all: half an arrow is not a thing this board stores);
//  - dragging one end of an arrow that is already selected (connector.handles), which is
//    the second way to start one and the only way to move an end that is already there.
//
// Everything else — selecting, moving, deleting, undo — is the machinery stories 7 and 8
// already had, reached through the registry. While an end is dragged the *document* is
// written, so what follows the pointer is the arrow itself and not a picture of it; the one
// preview drawn here is the arrow being born, which has no id yet and so cannot be real.
//
// The dots come from measuring rather than from the DOM. While this layer is held it — not
// the shape underneath — is what the pointer is on, so there is no element to ask: the
// object boxes are turned into their four side anchors, those into screen points, and the
// pointer is compared with them in *screen* pixels, which is what makes a dot as easy to
// hit at 25% as at 400%.

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { SelectionApi } from '../board/useSelection';
import { useUndoController } from '../board/useUndo';
import { useWindowPointer } from './useWindowPointer';
import { localPoint, toolLayerStyle } from './toolSurface';
import { topObjectIdAt } from './objectAtPoint';
import { objectBounds, objectSnapshots } from '../../shared/board-model';
import {
  connectorPolyline,
  distanceToPolyline,
  nearestSide,
  sideAnchor,
  sideAnchors,
} from '../../shared/geometry';
import type { Endpoint, Side } from '../../shared/geometry';
import {
  connectorSnapshot,
  endpointObjectId,
  type ConnectorEnd,
} from '../../shared/objects/connector';
import type { ConnectorSnap } from '../../shared/objects/connector';
import {
  CONNECTOR_COLOR,
  CONNECTOR_DOT_HIGHLIGHT_COLOR,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_SIDES,
} from '../../shared/config';

export interface ConnectorToolProps {
  doc: Y.Doc;
  /** The board's surface element, for turning client points into board points. */
  surface: HTMLElement | null;
  /** The camera as it is rendered — the same one the board just painted with. */
  camera: Camera;
  canEdit: boolean;
  /** Whether this tool is the tool the board is holding. */
  active: boolean;
  selection: SelectionApi;
  /**
   * Write the new arrow. Returns its id, or null when the model refused it: two ends on one
   * object, or an arrow shorter than the minimum, is refused there, before any transaction
   * is opened (connector.no_self, connector.no_accidental).
   */
  onCreate(from: Endpoint, to: Endpoint): string | null;
  /** An arrow was created: it becomes the selection and the board goes back to Select. */
  onCreated(id: string): void;
  /**
   * Move one end of an existing arrow: to an object when the pointer is on a dot, to a free
   * point when it is not. False when the model refused it — an arrow cannot join one object
   * to itself.
   */
  onWriteEnd(id: string, end: ConnectorEnd, target: Endpoint): boolean;
}

/** What the tool hands the board through its ref: begin dragging one end of an arrow. */
export interface ConnectorToolHandle {
  beginEndDrag(e: ReactPointerEvent<Element>, id: string, end: ConnectorEnd): void;
}

/** One connection dot, in screen coordinates, with the end it would write. */
interface Dot {
  /** The endpoint this dot writes: the object, and this side's anchor as its fallback. */
  value: Endpoint;
  side: Side;
  x: number;
  y: number;
  /** The object's box on screen, so a test can see the dot is on the object's edge. */
  box: string;
}

/** The arrow being drawn. */
interface Draft {
  pointerId: number;
  /** The end the arrow will start from, or null when it started on empty board. */
  from: Endpoint | null;
  /** The end the pointer is over: an object's dot, or nothing. */
  to: Endpoint | null;
  /**
   * The object the pointer's end of this drag has been over at any point, whether or not the
   * pointer is over it now. A drag that was aimed at a thing and lost it — because somebody
   * else deleted it while the press was held — is a different thing from a drag that never
   * found one.
   */
  aimedAt: string | null;
  tail: Point;
  head: Point;
}

/**
 * Whether two measurements of the dots are the same dot.
 *
 * The dots are measured from the document afresh whenever the pointer moves, so the object
 * that says "this one is lit" is never the same object as the one being drawn — and a dot is
 * a place on an object, not a record in an array.
 */
function sameDot(a: Dot, b: Dot): boolean {
  return a.side === b.side && endpointObjectId(a.value) === endpointObjectId(b.value);
}

/** The drag of one end of an arrow that already exists. */
interface EndDrag {
  pointerId: number;
  id: string;
  end: ConnectorEnd;
  /** Where this end was when the drag began, so a refusal can be put back. */
  original: Endpoint;
}

export const ConnectorTool = forwardRef<ConnectorToolHandle, ConnectorToolProps>(
  function ConnectorTool(props, ref) {
    const { doc, surface, camera, canEdit, active, selection, onCreate, onCreated, onWriteEnd } = props;

    // Fresh on every render, so a listener bound once for the mount never converts a point
    // with a camera that is no longer the one on screen.
    const live = useRef({ doc, surface, camera, selection, onCreate, onCreated, onWriteEnd });
    live.current = { doc, surface, camera, selection, onCreate, onCreated, onWriteEnd };

    const undo = useUndoController();
    const dotsRef = useRef<Dot[]>([]);
    const draftRef = useRef<Draft | null>(null);
    const endDragRef = useRef<EndDrag | null>(null);
    const [preview, setPreview] = useState<Draft | null>(null);
    const [dots, setDots] = useState<Dot[]>([]);
    /**
     * The dot the arrow would use if the pointer were let go where it is: the one the
     * pointer is over when nothing is being dragged, and the one the drag has settled on
     * while it is (connector.hover_points, connector.drag_dot).
     */
    const [lit, setLit] = useState<Dot | null>(null);

    /** Every dot the board can offer right now, in screen coordinates. */
    const measureDots = useCallback((): Dot[] => {
      const cam = live.current.camera;
      const out: Dot[] = [];
      for (const obj of objectSnapshots(live.current.doc)) {
        if (obj.type === 'connector') continue; // an arrow's ends are handles, not dots
        const box = objectBounds(obj);
        const anchors = sideAnchors(box);
        const screenBox = `${cam.x + box.x * cam.zoom},${cam.y + box.y * cam.zoom},${
          cam.x + (box.x + box.width) * cam.zoom
        },${cam.y + (box.y + box.height) * cam.zoom}`;
        for (const side of CONNECTOR_SIDES) {
          const world = anchors[side];
          const p = worldToScreen(cam, world);
          out.push({
            // The side's anchor is stored as the endpoint's fallback: it is the last place
            // that side was, which is where the arrow is released to if the object goes.
            value: { kind: 'attached', objectId: obj.id, fallback: world },
            side,
            x: p.x,
            y: p.y,
            box: screenBox,
          });
        }
      }
      dotsRef.current = out;
      return out;
    }, []);

    /** The dot nearest a screen point, within the screen allowance an arrow is worth. */
    const nearestDot = useCallback((p: Point): Dot | null => {
      let best: Dot | null = null;
      let bestDistance = CONNECTOR_HIT_TOLERANCE_PX + CONNECTOR_DOT_RADIUS_PX;
      for (const dot of dotsRef.current) {
        const d = Math.hypot(dot.x - p.x, dot.y - p.y);
        if (d <= bestDistance) {
          bestDistance = d;
          best = dot;
        }
      }
      return best;
    }, []);

    /** The arrow, if any, whose line lies under this screen point (connector.select). */
    const connectorAt = useCallback((screen: Point): ConnectorSnap | null => {
      const cam = live.current.camera;
      const world = screenToWorld(cam, screen);
      // The screen allowance, turned into board units at the zoom it was measured in:
      // the same rule the object's own hit target uses.
      const tolerance = CONNECTOR_HIT_TOLERANCE_PX / cam.zoom;
      let best: ConnectorSnap | null = null;
      let bestDistance = tolerance;
      for (const obj of objectSnapshots(live.current.doc)) {
        if (obj.type !== 'connector') continue;
        const snap = obj as ConnectorSnap;
        const line = connectorPolyline(snap.endpoints);
        if (line.length < 2) continue;
        const d = distanceToPolyline(line, world);
        if (d <= bestDistance) {
          bestDistance = d;
          best = snap;
        }
      }
      return best;
    }, []);

    /**
     * What an arrow's end would be joined to if the pointer were let go here: the dot it is
     * on, or the object it is over, or nothing at all (connector.drag_dot,
     * connector.drag_anywhere, connector.empty).
     *
     * The dot comes first because it is the thing a person aimed at. The object comes second
     * because an arrow is joined to a *thing* and not to a pixel: letting go in the middle of
     * a shape joins the arrow to that shape, and which side it leaves from is the model's
     * business, worked out again from the boxes on every render. Objects that an arrow here
     * would be refused for — the one the other end is already joined to — are not offered.
     */
    const endAt = useCallback(
      (
        screen: Point,
        world: Point,
        exclude: string | null,
      ): { value: Endpoint; dot: Dot | null } | null => {
        // The dots are measured again here, and not taken from the last move. A release is
        // resolved at the moment of the release, and anything can have happened since the
        // pointer last moved: the person let go without moving (a flick), or somebody else
        // deleted the object this end was reaching for. A dot measured before that delete
        // would join the arrow to an object that is no longer on the board, which is the one
        // thing a release must not do (connector.no_target).
        measureDots();
        const dot = nearestDot(screen);
        const dotObject = dot === null ? null : endpointObjectId(dot.value);
        // A dot on the object this arrow is already joined to is not offered: the model
        // would refuse the arrow, and a preview that is refused on every move is a preview
        // that appears not to work.
        if (dot !== null && dotObject !== null && dotObject !== exclude) {
          return { value: dot.value, dot };
        }
        // The document is measured here rather than handed in: the tool and the board have
        // to agree about what is under the pointer, and the document is the only thing the
        // two of them share.
        const id = topObjectIdAt(objectSnapshots(live.current.doc), world);
        if (id === null || id === exclude) return null;
        const obj = objectSnapshots(live.current.doc).find((o) => o.id === id);
        if (!obj) return null;
        const box = objectBounds(obj);
        return {
          value: {
            kind: 'attached',
            objectId: id,
            fallback: sideAnchor(box, nearestSide(box, world)),
          },
          dot: null,
        };
      },
      [measureDots, nearestDot],
    );

    /** The object the other end of this arrow is joined to, if it is joined to one. */
    const otherEndObject = useCallback((id: string, end: ConnectorEnd): string | null => {
      const snap = connectorSnapshot(live.current.doc, id);
      if (!snap) return null;
      const other = end === 'from' ? snap.to : snap.from;
      return other.kind === 'attached' ? other.objectId : null;
    }, []);

    /** The handle of a *selected* arrow under this screen point (connector.handles). */
    const handleAt = useCallback((screen: Point): { id: string; end: ConnectorEnd } | null => {
      const cam = live.current.camera;
      const reach = CONNECTOR_HIT_TOLERANCE_PX + CONNECTOR_DOT_RADIUS_PX;
      for (const obj of objectSnapshots(live.current.doc)) {
        if (obj.type !== 'connector') continue;
        if (!live.current.selection.ids.has(obj.id)) continue;
        const snap = obj as ConnectorSnap;
        for (const end of ['from', 'to'] as const) {
          const p = end === 'from' ? snap.endpoints.from : snap.endpoints.to;
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          const s = worldToScreen(cam, p);
          if (Math.hypot(s.x - screen.x, s.y - screen.y) <= reach) return { id: snap.id, end };
        }
      }
      return null;
    }, []);

    const stopDraft = useCallback(() => {
      draftRef.current = null;
      setPreview(null);
      // Nothing is being aimed at any more; the next move of the pointer lights a dot again.
      setLit(null);
    }, []);

    /**
     * Move one end of an existing arrow to wherever the pointer is. The document is written
     * as the drag goes, so the arrow that follows the pointer is the arrow itself and not a
     * picture of it (connector.follow) — which is what lets a second tab watch the end
     * travel. A refusal puts the end back where the drag started: an arrow cannot join one
     * object to itself, and an end left pointing at a refusal is an arrow that is wrong.
     */
    const followEnd = useCallback(
      (drag: EndDrag, screen: Point, world: Point): void => {
        const chosen = endAt(screen, world, otherEndObject(drag.id, drag.end));
        setLit(chosen?.dot ?? null);
        // Whatever `endAt` just measured is also what is shown. The dots are the sides of
        // whatever is on the board, and if somebody else's delete took an object away during
        // this drag, the dots on the screen say so on this move rather than keeping a hint for
        // a thing that is gone (connector.no_target).
        setDots(dotsRef.current);
        const target: Endpoint = chosen
          ? chosen.value
          : { kind: 'free', x: world.x, y: world.y };
        if (!live.current.onWriteEnd(drag.id, drag.end, target)) {
          live.current.onWriteEnd(drag.id, drag.end, drag.original);
        }
      },
      [endAt, otherEndObject, setDots],
    );

    const onMove = useCallback(
      (e: PointerEvent) => {
        const screen = localPoint(live.current.surface, e);
        const world = screenToWorld(live.current.camera, screen);

        // An end of an existing arrow is being dragged: the arrow itself follows the
        // pointer, in the document, as it goes.
        const endDrag = endDragRef.current;
        if (endDrag && e.pointerId === endDrag.pointerId) {
          followEnd(endDrag, screen, world);
          return;
        }

        const draft = draftRef.current;
        if (draft && e.pointerId === draft.pointerId) {
          const exclude = draft.from?.kind === 'attached' ? draft.from.objectId : null;
          const chosen = endAt(screen, world, exclude);
          setLit(chosen?.dot ?? null);
          setDots(dotsRef.current);
          const next: Draft = {
            ...draft,
            to: chosen ? chosen.value : null,
            // What the drag is aimed at is remembered for the whole drag, and not rewritten to
            // "nothing" the moment the pointer stops being over it: the object can be taken out
            // from under the pointer by somebody else, and the drag still knows what it was
            // aimed at (connector.no_target).
            aimedAt: draft.aimedAt ?? (chosen ? endpointObjectId(chosen.value) : null),
            // The head sits on the dot when there is one, and on the pointer when there is
            // not: the arrow is drawn to where the join will actually be.
            head: chosen?.dot ? { x: chosen.dot.x, y: chosen.dot.y } : screen,
          };
          draftRef.current = next;
          setPreview(next);
          return;
        }

        // Nothing is being dragged: the dots are shown while the pointer is over the board,
        // and the nearest one is drawn filled in (connector.hover_points).
        measureDots();
        setDots(dotsRef.current);
        setLit(nearestDot(screen));
      },
      [endAt, followEnd, measureDots, nearestDot, setDots],
    );

    const onUp = useCallback(
      (e: PointerEvent) => {
        const endDrag = endDragRef.current;
        if (endDrag && e.pointerId === endDrag.pointerId) {
          endDragRef.current = null;
          // The place the pointer was let go is written too: a drag whose last pointermove
          // was a few pixels short of where the hand stopped would leave the end there, and
          // a person releases where they mean to put a thing.
          const screen = localPoint(live.current.surface, e);
          followEnd(endDrag, screen, screenToWorld(live.current.camera, screen));
          setLit(null);
          // The whole drag is one undo step: one Ctrl+Z puts the end back (undo.step).
          undo?.boundary();
          return;
        }
        const draft = draftRef.current;
        if (!draft || e.pointerId !== draft.pointerId) return;
        const screen = localPoint(live.current.surface, e);
        const world = screenToWorld(live.current.camera, screen);
        const exclude = draft.from?.kind === 'attached' ? draft.from.objectId : null;
        const chosen = endAt(screen, world, exclude);
        // Let go over empty board: nothing is written, the preview goes away and the tool
        // stays where it was (connector.empty). An arrow needs a thing at both ends.
        //
        // There is one case that is not that, and it is the case where the thing this drag was
        // aimed at has gone away. Another person can delete it while this press is held; the
        // person drawing has still made the arrow — out of a dot on A, across the board, let go
        // where B was — and throwing it away tells them nothing happened. So an end whose object
        // is no longer on the board is written as a point on the board at the place the pointer
        // was let go: the arrow they drew is there, and it is joined to nothing, which is what
        // is true now (connector.no_target). Releasing over empty board that has never held an
        // object is still releasing over empty board, and still writes nothing.
        const aimed = draft.aimedAt;
        const lost =
          chosen === null &&
          aimed !== null &&
          aimed !== exclude &&
          !objectSnapshots(live.current.doc).some((o) => o.id === aimed);
        if (!draft.from || (!chosen && !lost)) {
          stopDraft();
          return;
        }
        const id = live.current.onCreate(
          draft.from,
          chosen ? chosen.value : { kind: 'free', x: world.x, y: world.y },
        );
        stopDraft();
        if (id) live.current.onCreated(id);
      },
      [endAt, stopDraft, followEnd, undo],
    );

    useWindowPointer({
      onMove,
      onUp,
      onCancel: () => {
        stopDraft();
        endDragRef.current = null;
      },
    });

    /** Begin dragging one end of a selected arrow: the tool's other gesture. */
    const beginEndDrag = useCallback(
      (e: ReactPointerEvent<Element>, id: string, end: ConnectorEnd) => {
        const snap = objectSnapshots(live.current.doc).find(
          (o): o is ConnectorSnap => o.id === id && o.type === 'connector',
        );
        if (!snap) return;
        const own = end === 'from' ? snap.from : snap.to;
        // An end that names an object that is gone has no handle on screen, so this cannot
        // be reached from a real press; say so quietly rather than move something that is
        // already where it is.
        if (!own) return;
        // An arrow that is not selected becomes selected first: what you grabbed is now
        // what you are pointing at (connector.drag_new).
        if (!live.current.selection.ids.has(id)) live.current.selection.click(id);
        // The drag is one undo step, and the value it may have to put back is remembered
        // before anything is written.
        undo?.boundary();
        endDragRef.current = { pointerId: e.pointerId, id, end, original: own };
        e.stopPropagation();
      },
      [measureDots, undo],
    );

    useImperativeHandle(ref, () => ({ beginEndDrag }), [beginEndDrag]);

    const onPointerDown = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!active || !canEdit || e.button !== 0) return;
        // This press is the tool's: never a pan, never a marquee, never a note's drag.
        e.stopPropagation();
        const screen = localPoint(live.current.surface, e);
        const world = screenToWorld(live.current.camera, screen);
        // The dots are measured from the document, and a press has to be able to find one
        // whether or not the pointer happened to move since the board was drawn.
        setDots(measureDots());

        // A handle of a selected arrow: the other gesture starts here.
        const handle = handleAt(screen);
        if (handle) {
          beginEndDrag(e, handle.id, handle.end);
          return;
        }

        // Press on an existing arrow: select it and start nothing (connector.select). The
        // line is what is measured, not its box, because most of the box is empty board.
        const existing = connectorAt(screen);
        if (existing) {
          if (!selection.ids.has(existing.id)) {
            if (e.shiftKey) selection.toggle(existing.id);
            else selection.click(existing.id);
          }
          return;
        }

        const dot = nearestDot(screen);
        if (!dot) {
          // Not a dot: whatever object is under the press is selected, and no arrow is
          // drawn over it — the same rule the Shape tool follows (shape.behind).
          const obj = topObjectIdAt(objectSnapshots(live.current.doc), world);
          if (obj !== null && !selection.ids.has(obj)) {
            if (e.shiftKey) selection.toggle(obj);
            else selection.click(obj);
          }
          return;
        }

        const tail = { x: dot.x, y: dot.y };
        const draft: Draft = {
          pointerId: e.pointerId,
          from: dot.value,
          to: null,
          aimedAt: null,
          tail,
          head: tail,
        };
        draftRef.current = draft;
        setPreview(draft);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      },
      [active, beginEndDrag, canEdit, connectorAt, handleAt, nearestDot, selection],
    );

    // The pointer has to be told where the dots are before it presses one, so they are
    // measured on the way in as well as on the way over.
    const onPointerOver = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!active) return;
        const screen = localPoint(live.current.surface, e);
        setDots(measureDots());
        setLit(nearestDot(screen));
      },
      [active, measureDots, nearestDot],
    );

    return (
      <div
        data-testid="connector-tool-layer"
        className="tool-layer connector-tool-layer"
        aria-hidden="true"
        style={toolLayerStyle(active, 'crosshair')}
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {dots.map((dot) => (
          <span
            key={`${dot.value.kind === 'attached' ? dot.value.objectId : 'free'}:${dot.side}`}
            data-lit={lit !== null && sameDot(lit, dot) ? 'true' : 'false'}
            data-testid="connector-dot"
            data-object-id={dot.value.kind === 'attached' ? dot.value.objectId : ''}
            data-side={dot.side}
            data-box={dot.box}
            data-highlighted={lit !== null && sameDot(lit, dot) ? 'true' : 'false'}
            style={{
              position: 'fixed',
              left: dot.x - CONNECTOR_DOT_RADIUS_PX,
              top: dot.y - CONNECTOR_DOT_RADIUS_PX,
              width: CONNECTOR_DOT_RADIUS_PX * 2,
              height: CONNECTOR_DOT_RADIUS_PX * 2,
              borderRadius: '50%',
              // The dot the arrow would use is the one that fills in: which one that is is
              // said by colour, not by a word.
              background:
                lit !== null && sameDot(lit, dot) ? CONNECTOR_DOT_HIGHLIGHT_COLOR : '#ffffff',
              border: `1px solid ${CONNECTOR_COLOR}`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        ))}
        {preview ? (
          <svg
            data-testid="connector-preview"
            data-attached={preview.to ? 'true' : 'false'}
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            <line
              x1={preview.tail.x}
              y1={preview.tail.y}
              x2={preview.head.x}
              y2={preview.head.y}
              stroke={CONNECTOR_COLOR}
              strokeWidth={Math.max(2 * camera.zoom, 1)}
              // A head that is attached is solid; one that is still in the air is dashed,
              // which is how the preview says "let go here and there is no arrow".
              strokeDasharray={preview.to ? undefined : '5 5'}
              strokeLinecap="round"
            />
            <circle
              cx={preview.tail.x}
              cy={preview.tail.y}
              r={CONNECTOR_DOT_RADIUS_PX}
              fill={CONNECTOR_COLOR}
            />
            {preview.to ? (
              <circle
                cx={preview.head.x}
                cy={preview.head.y}
                r={CONNECTOR_DOT_RADIUS_PX}
                fill={CONNECTOR_DOT_HIGHLIGHT_COLOR}
              />
            ) : null}
          </svg>
        ) : null}
      </div>
    );
  },
);

/**
 * The side of an object a press on it is nearer — used when a press lands on a shape but
 * not on one of its dots: the arrow then comes off the side the press is closest to rather
 * than the object's centre, which is what makes an arrow drawn from a shape's left edge
 * come out of its left edge.
 */
export function sidePressedOn(
  box: { x: number; y: number; width: number; height: number },
  point: Point,
): Side {
  return nearestSide(box, point);
}
