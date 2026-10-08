import * as React from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Doc } from 'yjs';
import type { Camera } from '../canvas/camera';
import { clampToLimit } from '../../shared/text-edit';
import { SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { objectBounds } from '../../shared/geometry';
import { registerObjectType } from './registry';

// Import fill and stroke color maps (stored as hex values)
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';

interface ShapeObjectProps {
  shape: ObjectSnapshot;
  doc?: Doc;
  selected: boolean;
  editing: boolean;
  onEndEdit(): void;
  camera: Camera;
}

export function ShapeObject(props: ShapeObjectProps): React.JSX.Element {
  const { shape, doc, selected, editing, onEndEdit, camera } = props;

  const kind = shape.kind || 'rect';
  const fillColor = resolveColor(shape.fill, SHAPE_FILL_COLORS);
  const strokeColor = resolveColor(shape.stroke, SHAPE_STROKE_COLORS);
  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  const w = shape.width ?? 160;
  const h = shape.height ?? 160;
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;

  // Label state
  const label = typeof shape.label === 'string' ? shape.label : String(shape.label || '');
  const [editValue, setEditValue] = React.useState(label);

  // On enter edit mode, sync value
  React.useEffect(() => {
    if (editing) {
      setEditValue(label);
    }
  }, [editing, label]);

  const handleDblClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Start editing via parent handler
      window.dispatchEvent(new CustomEvent('vidi6:startShapeEdit', { detail: { id: shape.id } }));
    },
    [shape.id],
  );

  const renderShape = () => {
    switch (kind) {
      case 'rect':
        return (
          <rect
            x={x + strokeWidth / 2}
            y={y + strokeWidth / 2}
            width={w - strokeWidth}
            height={h - strokeWidth}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            style={{ pointerEvents: 'none' }}
          />
        );
      case 'ellipse':
        return (
          <>
            <ellipse
              cx={x + w / 2}
              cy={y + h / 2}
              rx={(w - strokeWidth) / 2}
              ry={(h - strokeWidth) / 2}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              style={{ pointerEvents: 'none' }}
            />
          </>
        );
      case 'diamond': {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const pad = strokeWidth / 2;
        return (
          <polygon
            points={`${cx},${y + pad} ${x + w - pad},${cy} ${cx},${y + h - pad} ${x + pad},${cy}`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        );
      }
      default:
        return null;
    }
  };

  // Compute label styling for wrapping within shape bounds
  const labelFontSize = Math.min(14, w / 8, h / 3);
  const labelMaxWidth = w - 20;

  return (
    <g
      role="group"
      aria-label={`Shape: ${kind}${shape.label ? `, label: ${shape.label}` : ''}`}
      tabIndex={selected ? 0 : -1}
      data-object-id={shape.id}
      data-type="shape"
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('vidi6:selectObject', { detail: { id: shape.id } }));
      }}
      onDoubleClick={handleDblClick}
    >
      {renderShape()}

      {/* Selection border */}
      {selected && !editing && (
        <rect
          x={x - 2}
          y={y - 2}
          width={w + 4}
          height={h + 4}
          fill="none"
          stroke="#1a73e8"
          strokeWidth={2}
          rx={4}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* ForeignObject for label editing */}
      {!editing ? (
        <foreignObject
          x={x + 10}
          y={y + 10}
          width={w - 20}
          height={h - 20}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              fontSize: `${labelFontSize}px`,
              fontFamily: 'Inter, system-ui, sans-serif',
              color: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              lineHeight: '1.3',
              userSelect: 'none',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {(label || '\u00A0').slice(0, SHAPE_LABEL_MAX_CHARS)}
          </div>
        </foreignObject>
      ) : (
        <foreignObject
          x={x + 10}
          y={y + 10}
          width={w - 20}
          height={h - 20}
          style={{ overflow: 'visible', pointerEvents: 'auto' }}
        >
          <input
            autoFocus
            value={editValue}
            onChange={(e) => {
              const val = e.target.value.slice(0, SHAPE_LABEL_MAX_CHARS);
              setEditValue(val);
            }}
            onBlur={() => {
              // Apply change to Y.Text if doc available
              if (doc && shape.id) {
                try {
                  const objects = doc.getMap('objects');
                  const obj = objects.get(shape.id) as Y.Map<any>;
                  if (obj) {
                    const labelText = obj.get('label') as Y.Text | undefined;
                    if (labelText instanceof Y.Text) {
                      // Update Y.Text content
                      const newContent = editValue.slice(0, SHAPE_LABEL_MAX_CHARS);
                      // Simple replace since it's local
                      doc.transact(() => {
                        const len = labelText.length;
                        if (len > 0) labelText.delete(0, len);
                        labelText.insert(0, newContent);
                      }, Symbol('local'));
                    }
                  }
                } catch { /* ignore */ }
              }
              onEndEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onEndEdit();
              } else if (e.key === 'Enter') {
                onEndEdit();
              }
            }}
            style={{
              width: '100%',
              height: '100%',
              fontSize: `${labelFontSize}px`,
              fontFamily: 'Inter, system-ui, sans-serif',
              color: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              padding: 0,
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          />
        </foreignObject>
      )}
    </g>
  );
}

function resolveColor(keyOrHex: string, palette: Record<string, string>): string {
  if (!keyOrHex) return 'transparent';
  // If it matches a key in palette, return its value; otherwise treat as hex
  const resolved = palette[keyOrHex];
  if (resolved) return resolved;
  // Already a hex value or transparent
  return keyOrHex;
}

// --- Registry registration ---
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj: ObjectSnapshot, worldPoint: { x: number; y: number }): boolean => {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.y >= bounds.y &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});
