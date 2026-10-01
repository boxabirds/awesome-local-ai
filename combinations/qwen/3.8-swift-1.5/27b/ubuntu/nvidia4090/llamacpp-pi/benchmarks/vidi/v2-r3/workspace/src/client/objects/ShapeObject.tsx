import { useRef, useCallback, type ReactElement } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD } from '../../shared/config';
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import { TextEditor } from '../objects/TextEditor';
import type { ObjectProps } from '../objects/registry';
import { SHAPE_LABEL_MAX_CHARS, TEXT_FONT_FAMILY } from '../../shared/config';

/**
 * A shape object (story 10, shape.ui).
 *
 * Renders an SVG shape (rect, ellipse, or diamond polygon) with fill/stroke
 * colours and a centred wrapping label. Double-click starts label editing.
 */
export function ShapeObject({
  obj,
  doc,
  selected,
  editing,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
}: ObjectProps): ReactElement {
  const shape = obj as ShapeSnap;
  const id = shape.id;
  const x = shape.x;
  const y = shape.y;
  const width = shape.width ?? 160;
  const height = shape.height ?? 160;
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest callbacks for native pointer handlers.
  const onObjectPointerDownRef = useRef(onObjectPointerDown);
  onObjectPointerDownRef.current = onObjectPointerDown;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;

  // Pointer interaction
  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onObjectPointerDownRef.current(e, id);
  }, [id]);

  const handleDoubleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    onStartEditRef.current(id);
  }, [id]);

  // Attach native listeners
  const refCallback = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (el) {
      el.addEventListener('pointerdown', handlePointerDown);
      el.addEventListener('dblclick', handleDoubleClick);
    }
  };

  const fill = SHAPE_FILL_COLORS[shape.fill] ?? '#FFFFFF';
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? '#263238';
  const sw = SHAPE_STROKE_WIDTH_WORLD;

  // SVG shape element
  let shapeEl: ReactElement;
  switch (shape.kind) {
    case 'ellipse':
      shapeEl = (
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
      );
      break;
    case 'diamond': {
      const pts = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
      shapeEl = (
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />
      );
      break;
    }
    case 'rect':
    default:
      shapeEl = (
        <rect width={width} height={height} fill={fill} stroke={stroke} strokeWidth={sw} />
      );
  }

  const ytext = getShapeLabel(doc, id);

  const handleEndEdit = (next: 'selected' | 'unselected') => {
    undo?.boundary();
    onEndEdit(next);
  };

  return (
    <div
      ref={refCallback}
      role="group"
      aria-label={`Shape: ${shape.label || shape.kind}`}
      data-testid={`shape-object-${id}`}
      data-selected={selected || undefined}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        zIndex: shape.z,
        outline: selected ? `2px solid #1565C0` : 'none',
        outlineOffset: 2,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {shapeEl}
      </svg>
      {editing && ytext ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <TextEditor
              ytext={ytext}
              fontPx={16}
              onEnd={handleEndEdit}
              undo={undo}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              ariaLabel="Shape label"
              testId="shape-label-editor"
              textAlign="center"
              paddingPx={8}
              showCounter
            />
          </div>
        </div>
      ) : shape.label ? (
        <div
          data-testid={`shape-label-${id}`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            boxSizing: 'border-box',
            textAlign: 'center',
            fontFamily: TEXT_FONT_FAMILY,
            fontSize: 16,
            lineHeight: 1.3,
            overflow: 'hidden',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
            color: '#222',
          }}
        >
          {shape.label}
        </div>
      ) : null}
    </div>
  );
}
