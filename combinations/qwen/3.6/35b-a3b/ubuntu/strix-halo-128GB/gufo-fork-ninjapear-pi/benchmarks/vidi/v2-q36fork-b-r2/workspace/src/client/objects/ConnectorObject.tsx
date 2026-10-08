import * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Doc } from 'yjs';
import { objectBounds } from '../../shared/geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_STROKE_WIDTH_WORLD } from '../../shared/config';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import type { Rect } from '../../shared/geometry';
import { registerObjectType } from './registry';

interface ConnectorObjectProps {
  connector: ObjectSnapshot;
  allObjects: readonly ObjectSnapshot[];
  doc?: Doc;
  selected: boolean;
  zoom: number;
}

export function ConnectorObject(props: ConnectorObjectProps): React.JSX.Element | null {
  const { connector, allObjects, doc, selected, zoom } = props;

  // Compute rects map for resolveEndpoints
  const rectsMap = React.useMemo(() => {
    const m = new Map<string, Rect>();
    for (const obj of allObjects) {
      if (obj.id && obj.type !== 'connector') {
        m.set(obj.id, objectBounds(obj));
      }
    }
    return m;
  }, [allObjects]);

  // Resolve endpoints from live data
  const endpoints = React.useMemo(
    () => resolveEndpoints(connector as any, rectsMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connector.from, connector.to, rectsMap],
  );

  const { from, to } = endpoints;
  const hitTolerance = CONNECTOR_HIT_TOLERANCE_PX / zoom;

  // Drag state for end handles
  const dragHandleRef = React.useRef<'from' | 'to' | null>(null);
  const isDraggingHandle = React.useRef(false);
  const hasDraggedHandle = React.useRef(false);

  // Pointer down on the SVG — could be on line or handle
  const svgOnPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();

      try {
        const targetEl = e.target as HTMLElement;
        if (targetEl.setPointerCapture) {
          targetEl.setPointerCapture(e.pointerId);
        }
      } catch { /* ignore */ }

      const target = e.target as SVGGElement | SVGSVGElement;
      const targetId = target.getAttribute('data-handle-end');

      if (targetId === 'from' || targetId === 'to') {
        dragHandleRef.current = targetId as 'from' | 'to';
        isDraggingHandle.current = true;
        hasDraggedHandle.current = false;
        return;
      }

      // Otherwise this might be a selection click — handled by parent
    },
    [],
  );

  const svgOnPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingHandle.current || !dragHandleRef.current) return;
      hasDraggedHandle.current = true;
      // Cursor change hint
      (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
    },
    [],
  );

  const svgOnPointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingHandle.current || !dragHandleRef.current) return;
      isDraggingHandle.current = false;
      dragHandleRef.current = null;

      if (!hasDraggedHandle.current) {
        // Not dragging — just a click, let parent handle selection
        return;
      }

      // Release over something — need to find what's under cursor
      // Use document elementFromPoint since we lost capture
      const x = e.clientX;
      const y = e.clientY;
      const elem = document.elementFromPoint(x, y);

      if (!elem || !doc) {
        // Released over empty space → detach
        if (doc) {
          const ep = { kind: 'free' as const, x, y };
          setConnectorEndpoint(doc, connector.id, dragHandleRef.current! as 'from' | 'to', ep);
        }
        return;
      }

      // Find which object is under the cursor
      const objEl = elem.closest('[data-object-id]');
      if (objEl) {
        const targetId = objEl.getAttribute('data-object-id');
        if (targetId && targetId !== connector.id) {
          // Attach to target — first get the current opposite endpoint to check it's not the same object
          const oppositeEnd = dragHandleRef.current === 'from' ? 'to' : 'from';
          const otherEp = (connector as any)[oppositeEnd];
          // Don't allow attaching to the same object at the other end
          if (otherEp?.kind === 'attached' && otherEp.objectId === targetId) {
            return; // Snap back — reject
          }
          setConnectorEndpoint(doc!, connector.id, dragHandleRef.current! as 'from' | 'to', {
            kind: 'attached' as const,
            objectId: targetId,
            fallback: { x: Number((elem as HTMLElement).getAttribute('data-screen-x') || x), y: Number((elem as HTMLElement).getAttribute('data-screen-y') || y) },
          });
        }
      }
    },
    [doc, connector.id, connector],
  );

  return (
    <g
      role="group"
      aria-label={`Arrow${selected ? ', selected' : ''}`}
      tabIndex={selected ? 0 : -1}
      data-object-id={connector.id}
      data-type="connector"
      onClick={(e) => {
        e.stopPropagation();
        if (!selected) {
          window.dispatchEvent(new CustomEvent('vidi6:selectObject', { detail: { id: connector.id } }));
        }
      }}
    >
      {/* Invisible wider hit area for the line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={hitTolerance * 2}
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Visible arrow line with marker */}
      <defs>
        <marker
          id={`arrowhead-${connector.id}`}
          markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
          orient="auto"
        >
          <polygon
            points="0 0, 10 5, 0 10"
            fill="#666"
          />
        </marker>
      </defs>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#666"
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        markerEnd={`url(#arrowhead-${connector.id})`}
        style={{ pointerEvents: 'none' }}
      />

      {/* End handles when selected */}
      {selected && (
        <>
          {/* From handle */}
          <g
            className="connector-handle-from"
            data-handle-end="from"
            onPointerDown={svgOnPointerDown}
            onPointerMove={svgOnPointerMove}
            onPointerUp={svgOnPointerUp}
            data-screen-x={from.x}
            data-screen-y={from.y}
            style={{ pointerEvents: 'all', cursor: 'grab' }}
          >
            <circle cx={from.x} cy={from.y} r={8} fill="#fff" stroke="#1a73e8" strokeWidth={2} />
          </g>

          {/* To handle (at arrowhead tip) */}
          <g
            className="connector-handle-to"
            data-handle-end="to"
            onPointerDown={svgOnPointerDown}
            onPointerMove={svgOnPointerMove}
            onPointerUp={svgOnPointerUp}
            data-screen-x={to.x}
            data-screen-y={to.y}
            style={{ pointerEvents: 'all', cursor: 'grab' }}
          >
            <circle cx={to.x} cy={to.y} r={8} fill="#fff" stroke="#1a73e8" strokeWidth={2} />
          </g>
        </>
      )}
    </g>
  );
}

// --- Registry registration ---
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (_obj: ObjectSnapshot, _wp: { x: number; y: number }): boolean => {
    // Connectors don't use registry hit-test; they handle their own clicks.
    return false;
  },
});
