/**
 * Shape object renderer (story 10, shape.ui).
 *
 * Renders an SVG shape (rect, ellipse, diamond) with fill/stroke colours
 * and a centred wrapping label in a foreignObject.
 */
import type * as Y from 'yjs';
import type { ObjectProps } from './registry';
import type { ShapeSnap } from '../../shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '../../shared/config';

export function ShapeObject({
  obj,
  doc,
  z,
  selected,
  editing,
  editable = true,
  onPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps) {
  const shape = obj as ShapeSnap;
  const { x, y, width, height, kind, fill, stroke, label } = shape;
  const w = width ?? 160;
  const h = height ?? 160;

  const fillColor = SHAPE_FILL_COLORS[fill] ?? SHAPE_FILL_COLORS.white;
  const strokeColor = SHAPE_STROKE_COLORS[stroke] ?? SHAPE_STROKE_COLORS.dark;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    onPointerDown(e, shape.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    if (editable) {
      onStartEdit(shape.id);
    }
  };

  const ytext = (doc.getMap('objects').get(shape.id) as Y.Map<unknown> | undefined)?.get('label') as
    | Y.Text
    | undefined;

  // Diamond vertices
  const diamondPoints = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;

  return (
    <svg
      data-testid="shape-object"
      data-shape-id={shape.id}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      role="group"
      aria-label={`Shape: ${kind}${label ? ` "${label}"` : ''}`}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: z,
        overflow: 'visible',
        cursor: 'grab',
        touchAction: 'none',
        outline: selected ? `2px solid #2563eb` : 'none',
        outlineOffset: 2,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {kind === 'rect' && (
        <rect
          width={w}
          height={h}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          rx={2}
        />
      )}
      {kind === 'ellipse' && (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      )}
      {kind === 'diamond' && (
        <polygon
          points={diamondPoints}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      )}

      {/* Label */}
      {editing && ytext ? (
        <foreignObject x={0} y={0} width={w} height={h}>
          <div
            data-testid="shape-label-editor"
            contentEditable
            suppressContentEditableWarning
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              overflow: 'hidden',
              fontSize: 14,
              fontFamily: 'system-ui, sans-serif',
              color: '#333',
              outline: '1px solid #3b82f6',
              boxSizing: 'border-box',
              padding: 4,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
            ref={(el) => {
              if (el && !el.textContent) {
                el.textContent = label;
              }
              if (el) el.focus();
            }}
            onBlur={onEndEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onEndEdit();
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onEndEdit();
              }
            }}
            onInput={(e) => {
              const el = e.target as HTMLElement;
              if (el.textContent && el.textContent.length > SHAPE_LABEL_MAX_CHARS) {
                el.textContent = el.textContent.slice(0, SHAPE_LABEL_MAX_CHARS);
                // Move cursor to end
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
              // Sync to Y.Text
              if (ytext && el.textContent !== ytext.toString()) {
                ytext.delete(0, ytext.length);
                if (el.textContent) {
                  ytext.insert(0, el.textContent);
                }
              }
            }}
          />
        </foreignObject>
      ) : (
        label && (
          <foreignObject x={0} y={0} width={w} height={h}>
            <div
              data-testid="shape-label"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                overflow: 'hidden',
                fontSize: 14,
                fontFamily: 'system-ui, sans-serif',
                color: '#333',
                pointerEvents: 'none',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                padding: 4,
                boxSizing: 'border-box',
              }}
            >
              {label}
            </div>
          </foreignObject>
        )
      )}
    </svg>
  );
}
