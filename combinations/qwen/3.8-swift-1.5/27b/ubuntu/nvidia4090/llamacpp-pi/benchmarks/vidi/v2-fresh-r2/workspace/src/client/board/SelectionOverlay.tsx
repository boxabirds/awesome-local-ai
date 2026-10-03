/**
 * Selection overlay (story 7, sel.outlines).
 *
 * Rendered in the world layer. Draws a thin blue outline around every
 * selected object, and — when more than one object is selected and the
 * selection is resizable — a bounding box with eight resize handles. Handles
 * are a constant screen size (HANDLE_SIZE_PX) at any zoom, so their world
 * size is HANDLE_SIZE_PX / zoom.
 */

import type { JSX } from 'react';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

/** Outline colour for selection outlines and the bounding box. */
const OUTLINE_COLOR = '#1a73e8';
/** Outline width in screen px (constant at any zoom). */
const OUTLINE_PX = 1.5;

const HANDLE_DEFS: Array<{ h: Handle; cx: number; cy: number; cursor: string }> = [
  { h: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { h: 'n', cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { h: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { h: 'e', cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { h: 'se', cx: 1, cy: 1, cursor: 'nwse-resize' },
  { h: 's', cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { h: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { h: 'w', cx: 0, cy: 0.5, cursor: 'ew-resize' },
];

export interface SelectionOverlayProps {
  /** All objects (to bound only the selected ones we filter here). */
  objects: readonly ObjectSnapshot[];
  /** The selected ids. */
  ids: ReadonlySet<string>;
  /** Current zoom (for constant-size handles/outlines). */
  zoom: number;
  /** Whether the selection is resizable (all selected types resizable). */
  resizable: boolean;
  /** Start a resize gesture on a handle. */
  onHandlePointerDown(e: React.PointerEvent<HTMLElement>, handle: Handle): void;
}

function handlePosition(box: Rect, def: { cx: number; cy: number }): Point {
  return { x: box.x + def.cx * box.width, y: box.y + def.cy * box.height };
}

export function SelectionOverlay({
  objects,
  ids,
  zoom,
  resizable,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  if (ids.size === 0) return null;

  const selected = objects.filter((o) => ids.has(o.id));
  const boxes = selected.map(objectBounds);
  const box = unionRects(boxes);
  const outlineW = OUTLINE_PX / zoom;
  const handleSize = HANDLE_SIZE_PX / zoom;
  const halfHandle = handleSize / 2;

  // Single-object handles: a text object shows only the left/right (e/w)
  // handles (its height follows the content, story 9); a freely resizable
  // type (story 10 shapes: resizable, not aspect-locked) shows all eight.
  // Aspect-locked singles (stickies) show none.
  const singleSpec =
    ids.size === 1 && selected.length === 1 ? getObjectType(selected[0].type) : undefined;
  const singleHorizontal = singleSpec?.handles === 'horizontal';
  const singleFree = !!singleSpec && singleSpec.resizable && !singleSpec.aspectLocked;
  const handleDefs: Array<{ h: Handle; cx: number; cy: number; cursor: string }> = singleHorizontal
    ? HANDLE_DEFS.filter((d) => d.h === 'e' || d.h === 'w')
    : HANDLE_DEFS;
  const showHandles = box && (singleHorizontal || singleFree || (ids.size > 1 && resizable));

  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      {/* Per-object thin outlines (connectors draw their own endpoint
          dots when selected — no box outline, story 10). */}
      {selected.filter((o) => o.type !== 'connector').map((o) => {
        const b = objectBounds(o);
        return (
          <div
            key={o.id}
            data-testid="selection-outline"
            style={{
              position: 'absolute',
              left: b.x - outlineW / 2,
              top: b.y - outlineW / 2,
              width: b.width + outlineW,
              height: b.height + outlineW,
              border: `${outlineW}px solid ${OUTLINE_COLOR}`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {/* Bounding box + handles: multi-select (resizable) or a single text
          object (horizontal-only handles). */}
      {showHandles ? (
        <>
          <div
            data-testid="selection-box"
            style={{
              position: 'absolute',
              left: box.x - outlineW / 2,
              top: box.y - outlineW / 2,
              width: box.width + outlineW,
              height: box.height + outlineW,
              border: `${outlineW}px solid ${OUTLINE_COLOR}`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          />
          {handleDefs.map((def) => {
            const p = handlePosition(box, def);
            return (
              <div
                key={def.h}
                data-testid={`resize-handle-${def.h}`}
                data-handle={def.h}
                role="button"
                aria-label={`Resize ${def.h}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onHandlePointerDown(e, def.h);
                }}
                style={{
                  position: 'absolute',
                  left: p.x - halfHandle,
                  top: p.y - halfHandle,
                  width: handleSize,
                  height: handleSize,
                  backgroundColor: '#fff',
                  border: `${outlineW}px solid ${OUTLINE_COLOR}`,
                  boxSizing: 'border-box',
                  cursor: def.cursor,
                  pointerEvents: 'auto',
                  touchAction: 'none',
                }}
              />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

