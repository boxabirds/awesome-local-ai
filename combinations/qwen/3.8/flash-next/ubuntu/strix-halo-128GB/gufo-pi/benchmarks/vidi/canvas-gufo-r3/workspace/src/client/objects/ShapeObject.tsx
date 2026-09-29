import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { ShapeSnap } from '@shared/board-model';
import type { UndoController } from '@client/board/undo';
import { getShapeLabel } from '@shared/objects/shape';
import { ShapeToolbar } from './ShapeToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import {
  SHAPE_LABEL_FONT_SIZE_WORLD,
  SHAPE_LABEL_LINE_HEIGHT,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '@shared/config';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  readOnly: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  undoController?: UndoController | null;
}

/** The SVG element for a shape kind, inset by the stroke so the outline stays inside the box. */
function ShapeSvg({
  kind,
  width,
  height,
  fill,
  stroke,
  ariaLabel,
}: {
  kind: ShapeSnap['kind'];
  width: number;
  height: number;
  fill: string;
  stroke: string;
  ariaLabel: string;
}): React.ReactElement {
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const inset = sw / 2;
  const w = Math.max(1, width - sw);
  const h = Math.max(1, height - sw);
  let el: React.ReactElement;
  if (kind === 'ellipse') {
    el = <ellipse cx={width / 2} cy={height / 2} rx={w / 2} ry={h / 2} />;
  } else if (kind === 'diamond') {
    const pts = `${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`;
    el = <polygon points={pts} />;
  } else {
    el = <rect x={inset} y={inset} width={w} height={h} />;
  }
  return (
    <svg
      data-testid="shape-svg"
      aria-label={ariaLabel}
      role="img"
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      <g fill={fill} stroke={stroke} strokeWidth={sw}>
        {el}
      </g>
    </svg>
  );
}

/**
 * Renders one shape (rectangle / ellipse / diamond) with a centred label.
 * Labels wrap and re-wrap on resize for free (CSS text flow, no auto-fit).
 * Editing reuses the sticky-note text editor with the SHAPE_LABEL_MAX_CHARS limit.
 */
export function ShapeObject(props: ShapeObjectProps): React.ReactElement {
  const {
    shape,
    doc,
    selected,
    editing,
    dragging,
    readOnly,
    onSelect,
    onToggle,
    onStartEdit,
    onEndEdit,
    onObjectPointerDown,
    undoController,
  } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [measurePx, setMeasurePx] = useState<number>(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      if (editing) return;
      e.preventDefault();

      if (e.shiftKey && onToggle) {
        onToggle(shape.id);
        return;
      }
      if (onObjectPointerDown) {
        onObjectPointerDown(e, shape.id);
      } else {
        onSelect(shape.id);
      }
    },
    [editing, shape.id, onSelect, onToggle, onObjectPointerDown, readOnly],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      if (editing) return;
      onSelect(shape.id);
      onStartEdit(shape.id);
    },
    [editing, shape.id, onSelect, onStartEdit, readOnly],
  );

  const labelYText = editing ? getShapeLabel(doc, shape.id) : undefined;

  // Deleted while editing -> end silently
  useEffect(() => {
    if (editing && !labelYText) onEndEdit('unselected');
  }, [editing, labelYText, onEndEdit]);

  // Measure text width in world units for crisp sub-pixel font sizing
  useEffect(() => {
    if (editing) return;
    const el = rootRef.current;
    if (!el) return;
    const px = shape.width - SHAPE_STROKE_WIDTH_WORLD * 2 - 16;
    setMeasurePx(Math.max(8, px));
  }, [shape.width, editing]);

  const labelColor = '#1A1A1A';
  const showToolbar = selected && !editing && !readOnly;

  return (
    <div
      data-testid="shape-wrapper"
      data-shape-id={shape.id}
      data-x={shape.x}
      data-y={shape.y}
      data-width={shape.width}
      data-height={shape.height}
      data-z={shape.z}
      data-kind={shape.kind}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        zIndex: shape.z,
      }}
    >
      <div
        ref={rootRef}
        role="group"
        aria-label={`${shape.kind} shape`}
        data-testid="shape-object"
        data-shape-id={shape.id}
        data-selected={selected ? 'true' : 'false'}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          if (!editing) onSelect(shape.id);
        }}
        style={{
          position: 'absolute',
          inset: 0,
          outline: selected ? '2px solid #1976D2' : 'none',
          outlineOffset: 2,
          cursor: readOnly ? 'default' : 'grab',
          touchAction: 'none',
        }}
      >
        <ShapeSvg
          kind={shape.kind}
          width={shape.width}
          height={shape.height}
          fill={shape.fill}
          stroke={shape.stroke}
          ariaLabel={`${shape.kind} shape`}
        />
        {editing && labelYText ? (
          <div
            style={{
              position: 'absolute',
              left: SHAPE_STROKE_WIDTH_WORLD + 8,
              right: SHAPE_STROKE_WIDTH_WORLD + 8,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          >
            <StickyTextEditor
              ytext={labelYText}
              fontPx={SHAPE_LABEL_FONT_SIZE_WORLD}
              padding={0}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              onEnd={onEndEdit}
              undoController={undoController}
            />
          </div>
        ) : (
          <div
            data-testid="shape-label"
            style={{
              position: 'absolute',
              left: SHAPE_STROKE_WIDTH_WORLD + 8,
              right: SHAPE_STROKE_WIDTH_WORLD + 8,
              top: '50%',
              transform: 'translateY(-50%)',
              textAlign: 'center',
              color: labelColor,
              fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
              fontSize: SHAPE_LABEL_FONT_SIZE_WORLD,
              lineHeight: SHAPE_LABEL_LINE_HEIGHT,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            {shape.label}
          </div>
        )}
      </div>
      {showToolbar && <ShapeToolbar doc={doc} shape={shape} undoController={undoController} />}
      {dragging && <div data-testid="shape-drag-proxy" style={{ position: 'absolute', inset: 0 }} />}
    </div>
  );
}
