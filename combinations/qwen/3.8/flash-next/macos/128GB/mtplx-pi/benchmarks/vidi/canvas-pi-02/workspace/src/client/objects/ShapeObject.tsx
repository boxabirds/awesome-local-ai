/**
 * Shape object renderer (story 10).
 *
 * Renders SVG shapes (rect, ellipse, diamond) with fill/stroke and a centred
 * label that wraps inside the shape.
 */
import { useRef, useEffect, type JSX } from 'react';
import * as Y from 'yjs';
import type { ShapeSnap } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff } from '../../shared/text-edit';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  selected: boolean;
  editing: boolean;
  onEndEdit(): void;
}

function renderShapeSVG(kind: string, w: number, h: number, fill: string, stroke: string): JSX.Element {
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  switch (kind) {
    case 'ellipse':
      return (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - sw / 2}
          ry={h / 2 - sw / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${w / 2},${sw / 2} ${w - sw / 2},${h / 2} ${w / 2},${h - sw / 2} ${sw / 2},${h / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    default:
      // rect
      return (
        <rect
          x={sw / 2}
          y={sw / 2}
          width={w - sw}
          height={h - sw}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
  }
}

export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const { shape, doc, selected, editing } = props;
  const { x, y, width: w, height: h, kind, fill: fillKey, stroke: strokeKey, label } = shape;
  const fill = SHAPE_FILL_COLORS[fillKey] || 'transparent';
  const stroke = SHAPE_STROKE_COLORS[strokeKey] || '#263238';

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try { el.setSelectionRange(len, len); } catch { /* noop */ }
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const el = rootRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== editorRef.current) {
        // Click outside editor ends editing.
        props.onEndEdit();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [editing]);

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    const labelYText = getShapeLabel(doc, shape.id);
    if (!labelYText) return;
    let val = el.value;
    if (val.length > SHAPE_LABEL_MAX_CHARS) {
      val = val.slice(0, SHAPE_LABEL_MAX_CHARS);
      el.value = val;
    }
    const current = labelYText.toString();
    if (current !== val) {
      applyTextDiff(labelYText, val, LOCAL_ORIGIN);
    }
  };

  return (
    <div
      ref={rootRef}
      data-testid="shape-object"
      data-board-object="shape"
      data-shape-id={shape.id}
      role="group"
      aria-label={`${kind} ${label || ''}`.trim()}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: selected ? 2 : 1,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) {
          // Double-click to edit is handled via the shape id in the parent.
          (e.target as HTMLElement).closest('[data-board-object]')?.dispatchEvent(
            new CustomEvent('shape-edit', { bubbles: true, detail: { id: shape.id } })
          );
        }
      }}
    >
      <svg
        width={w}
        height={h}
        style={{ position: 'absolute', top: 0, left: 0 }}
        focusable="false"
      >
        {renderShapeSVG(kind, w, h, fill, stroke)}
      </svg>
      {editing ? (
        <textarea
          ref={editorRef}
          data-testid="shape-label-editor"
          defaultValue={label}
          onInput={handleInput}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            fontSize: 14,
            lineHeight: 1.3,
          }}
          spellCheck={false}
          aria-label="Shape label"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              props.onEndEdit();
            }
          }}
        />
      ) : (
        label ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
              fontSize: 14,
              lineHeight: 1.3,
              textAlign: 'center',
              pointerEvents: 'none',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {label}
          </div>
        ) : null
      )}
    </div>
  );
}
