/**
 * The Connector tool: the pointer that draws an arrow between two things.
 *
 * It has the same hold on the pointer as the other two writing tools, for the same reason and by the same
 * means — listeners on the document, in the capture phase, stopping the event where it stands — because the
 * press that begins an arrow is not a request to move the shape it happened to land on, nor to pan the
 * board, nor to drop the selection. On top of that hold it does one thing the other tools never had to: it
 * answers the question *what am I pointing at* while the pointer is merely moving, because an arrow is
 * attached to shapes and a person drawing one has to be able to see which shape is being aimed at.
 *
 * That is the whole of the tool's two states:
 * — **over a shape**: four dots, at the middle of each of its four sides, which are the four places an end
 *   of an arrow can go. Not a decoration — they are the answer to "where would it land", and they are
 *   computed from the same two functions the arrow itself is drawn with, so the dot is where the arrow will
 *   actually be.
 * — **dragging**: the arrow, from wherever its first end is, to the pointer; and when the pointer is over a
 *   shape at the far end, one of those four dots lit up — the side that faces wherever the other end has
 *   come from, which is the side the arrow will attach to.
 *
 * Both are drawn in screen coordinates and neither writes anything. The only write is the one the release
 * makes, and it is a write the model may refuse: an arrow from a shape to itself, or an arrow of less than
 * nothing, produces no arrow at all and leaves the tool exactly where it was.
 */

import { useEffect, useRef, useState } from 'react';
import type { Doc } from 'yjs';

import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { resolveEndpoints, nearestSide, sideAnchor, SIDES, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { topmostObjectAt } from '../objects/registry';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { UndoControls } from '../board/useUndo';

export interface ConnectorToolProps {
  /** The document the arrow is written into. */
  doc: Doc;
  /** The camera the pointer is read through, for the preview's position and size. */
  camera: Camera;
  /** Every object on the board, in stacking order: what a pointer is over is asked of these. */
  objects: readonly ObjectSnapshot[];
  /** Every object's box, by id — the arrow's ends are placed from these, and from nothing else. */
  rects: ReadonlyMap<string, Rect>;
  /** Turns a point on this screen into a point on the board. */
  toWorld(point: Point): Point;
  /** Who made it. */
  by?: string;
  /** This person's undo history: one arrow is one step, whatever came before it. */
  undo?: UndoControls;
  /** An arrow was created: select it, and go back to Select. */
  onCreated(id: string): void;
}

/** The arrow this pointer is dragging, before anybody knows whether it is going to be an arrow. */
interface Drag {
  pointerId: number;
  /** The end that was anchored first: a shape the pointer went down on, or the point it went down over. */
  from: Endpoint;
  /** Where the pointer is now. */
  current: Point;
  /** The shape the far end would land on, if there is one under the pointer. */
  target: string | null;
}

/** What is being shown: the shape under the pointer, and the end of it that is lit. */
interface Highlight {
  /** The shape whose four dots are on the screen. */
  id: string;
  /** The side the arrow would attach to, when the far end of a drag has already decided it. */
  side: Side | null;
}

/** Buttons, toolbars and open text fields keep their own clicks, whatever tool is lit. */
const isControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest('button, textarea, input, select, [role="toolbar"]') !== null;

export function ConnectorTool(props: ConnectorToolProps): React.JSX.Element | null {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // The listeners are installed once and read whatever is on the board through this ref, because the board
  // changes underneath a drag — the shape it started on may be moved by somebody else while the arrow is in
  // the air — and the arrow has to be drawn from where things are now.
  const latest = useRef(props);
  latest.current = props;
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    /** The object a pointer is over, of the ones on the board, this tool's own previews excepted. */
    const objectUnder = (world: Point): ObjectSnapshot | null => {
      const view = latest.current;
      return topmostObjectAt(view.objects, world, { zoom: view.camera.zoom, rects: view.rects });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isControl(event.target)) return;
      // Taken off the board and off the object underneath it: see the note at the top of this file.
      // Taken off the board and off the object underneath it: see the note at the top of this file. Stopped
      // with `stopPropagation`, the same line BoardViewport draws for the Text tool, so that a press which
      // begins an arrow still reaches an open text editor's handler on the document and commits what was
      // typed into it.
      event.stopPropagation();
      event.preventDefault();
      const world = latest.current.toWorld({ x: event.clientX, y: event.clientY });
      const target = objectUnder(world);
      // The end that starts on a shape is attached to that shape, with the point that was pressed as its
      // fallback; the model replaces the fallback with the real anchor when it writes, if the shape is
      // still there to be asked. An end that starts over nothing is a point and stays one.
      const from: Endpoint =
        target === null ? { kind: 'free', x: world.x, y: world.y } : { kind: 'attached', objectId: target.id, fallback: world };
      dragRef.current = { pointerId: event.pointerId, from, current: world, target: null };
      setDrag(dragRef.current);
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      const view = latest.current;
      const world = view.toWorld({ x: event.clientX, y: event.clientY });
      if (current === null) {
        // Not dragging: the dots are the whole of what is shown, and they follow the pointer.
        const under = objectUnder(world);
        setHover((previous) => (previous === (under?.id ?? null) ? previous : under?.id ?? null));
        return;
      }
      if (event.pointerId !== current.pointerId) return;
      event.stopPropagation();
      const under = objectUnder(world);
      current.current = world;
      current.target = under?.id ?? null;
      setDrag({ ...current });
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current === null || event.pointerId !== current.pointerId) return;
      event.stopPropagation();
      dragRef.current = null;
      setDrag(null);
      setHover(null);
      // A pointer the system took back is not an arrow somebody drew.
      if (event.type !== 'pointerup') return;

      const view = latest.current;
      const world = view.toWorld({ x: event.clientX, y: event.clientY });
      const under = objectUnder(world);
      const to: Endpoint =
        under === null
          ? { kind: 'free', x: world.x, y: world.y }
          : { kind: 'attached', objectId: under.id, fallback: world };

      const history = view.undo;
      // An arrow is one step of the history, for the same reason a shape and a note are: the write that made
      // it has to be undoable on its own.
      history?.boundary();
      const id = createConnector(view.doc, current.from, to, view.by ?? '');
      history?.boundary();
      // A refusal — the same shape at both ends, or an arrow too short to be an arrow — creates nothing,
      // says nothing and leaves the tool where it was.
      if (typeof id === 'string') view.onCreated(id);
    };

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      // An unfinished drag leaves with the tool, and writes nothing on the way out.
      dragRef.current = null;
      setDrag(null);
      setHover(null);
    };
    // Once for as long as the tool is on screen; everything it needs is read from `latest`.
  }, []);

  const camera = props.camera;
  const screen = (world: Point): Point => worldToScreen(camera, world);
  const dots = (rect: Rect): Record<Side, Point> =>
    SIDES.reduce((all, side) => ({ ...all, [side]: screen(sideAnchor(rect, side)) }), {} as Record<Side, Point>);

  // What is lit: the shape the far end of a drag is over — its attaching side known — or, with nothing being
  // dragged, the shape the pointer is merely hovering over.
  const highlight = ((): Highlight | null => {
    if (drag !== null) {
      if (drag.target === null) return null;
      const rect = props.rects.get(drag.target);
      if (rect === undefined) return null;
      // Which side it will attach to is asked of the same two functions the arrow is drawn with, so that the
      // lit dot is where the end of the arrow will actually be and not a guess about it. The end being
      // dragged aims at wherever the first end is drawn.
      const anchors = resolveEndpoints({ from: drag.from, to: { kind: 'attached', objectId: drag.target, fallback: drag.current } }, props.rects);
      return { id: drag.target, side: nearestSide(rect, anchors.from) };
    }
    return hover === null ? null : { id: hover, side: null };
  })();

  const highlightRect = highlight === null ? undefined : props.rects.get(highlight.id);
  const ends = drag === null ? null : resolveEndpoints({ from: drag.from, to: { kind: 'free', x: drag.current.x, y: drag.current.y } }, props.rects);

  if (highlight === null && drag === null) return null;

  return (
    <div
      aria-hidden="true"
      className="connector-tool-layer"
      data-testid="connector-tool-layer"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none' } as React.CSSProperties}
    >
      {highlight === null || highlightRect === undefined ? null : (
        <div className="connector-dots" data-testid="connector-dots" data-hover-object-id={highlight.id}>
          {SIDES.map((side) => {
            const at = dots(highlightRect)[side];
            const lit = highlight.side === side;
            return (
              <span
                key={side}
                className={lit ? 'connector-dot connector-dot-active' : 'connector-dot'}
                data-side={side}
                data-testid={`connector-dot-${side}`}
                data-active={lit ? 'true' : undefined}
                style={
                  {
                    position: 'fixed',
                    left: `${at.x - CONNECTOR_DOT_RADIUS_PX}px`,
                    top: `${at.y - CONNECTOR_DOT_RADIUS_PX}px`,
                    width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                    height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
      )}
      {ends === null ? null : (
        <svg className="connector-preview-svg" data-testid="connector-preview" style={{ position: 'fixed', inset: 0, overflow: 'visible' } as React.CSSProperties}>
          <line
            strokeDasharray="6 4"
            strokeWidth={2}
            x1={screen(ends.from).x}
            x2={screen(ends.to).x}
            y1={screen(ends.from).y}
            y2={screen(ends.to).y}
          />
        </svg>
      )}
    </div>
  );
}
