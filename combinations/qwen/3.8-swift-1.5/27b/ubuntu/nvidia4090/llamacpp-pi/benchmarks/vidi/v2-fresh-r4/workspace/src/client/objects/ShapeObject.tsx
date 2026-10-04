/**
 * ShapeObject (story 10): renders a shape (rect / ellipse / diamond) with a
 * centred label. The label is a Y.Text: display mode shows the text, edit
 * mode (double-click) shows a textarea that writes through `applyTextDiff`.
 *
 * The shape is drawn as an inline SVG in world coordinates (the parent
 * `.board-objects` layer is camera-transformed). The label lives in a
 * `foreignObject` so it wraps and clips like normal HTML text.
 */
import { useEffect, useState, type JSX } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { getShapeLabel, type ShapeKind, type ShapeSnap } from '../../shared/objects/shape';
import { LOCAL_ORIGIN } from '../../shared/board-model';

const KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  selected: boolean;
  editing: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onDoubleClick(e: React.MouseEvent, id: string): void;
  /** Close the label editor (Escape/Enter/blur). */
  onEndEdit(): void;
  /** Close the undo capture window (label committed). */
  onBoundary?(): void;
  onUndo?(): void;
  onRedo?(): void;
}

/**
 * Label editor for shapes: a textarea centred in the shape that clamps to
 * SHAPE_LABEL_MAX_CHARS and writes Y.Text diffs locally.
 */
function ShapeLabelEditor(props: {
  ytext: Y.Text;
  onEndEdit(): void;
  onBoundary?(): void;
  onUndo?(): void;
  onRedo?(): void;
}): JSX.Element {
  const { ytext } = props;
  const [value, setValue] = useState(() => ytext.toString());

  // Sync from remote/local Y.Text changes that don't originate in this editor.
  useEffect(() => {
    const sync = () => setValue(ytext.toString());
    ytext.observe(sync);
    return () => {
      ytext.unobserve(sync);
    };
  }, [ytext]);

  const commit = () => {
    props.onBoundary?.();
    props.onEndEdit();
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const v = clampToLimit(e.currentTarget.value, SHAPE_LABEL_MAX_CHARS);
    setValue(v);
    applyTextDiff(ytext, v, LOCAL_ORIGIN);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      props.onUndo?.();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      props.onRedo?.();
    } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      props.onRedo?.();
    }
  };

  return (
    <textarea
      data-vidi6="shape-label-editor"
      aria-label="Shape label"
      className="shape-label-editor"
      value={value}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      autoFocus
      spellCheck={false}
    />
  );
}

export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const { shape, doc, selected, editing } = props;
  const label = shape.label;
  const w = shape.width ?? SHAPE_DEFAULT_SIZE_WORLD;
  const h = shape.height ?? SHAPE_DEFAULT_SIZE_WORLD;
  const fill = SHAPE_FILL_COLORS[shape.fill] ?? 'transparent';
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? SHAPE_STROKE_COLORS.dark;
  const kindName = KIND_NAMES[shape.kind];
  const ariaLabel = label ? `${kindName}: ${label}` : kindName;
  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;

  return (
    <svg
      data-vidi6="shape"
      data-vidi6-kind={shape.kind}
      data-selected={selected || undefined}
      role="img"
      aria-label={ariaLabel}
      className="shape-object"
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        zIndex: shape.z,
        overflow: 'visible',
        pointerEvents: editing ? 'none' : 'auto',
      }}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      onPointerDown={(e) => {
        if (!editing) props.onPointerDown(e, shape.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onDoubleClick(e, shape.id);
      }}
    >
      {shape.kind === 'rect' && (
        <rect
          data-vidi6="shape-body"
          x={0}
          y={0}
          width={w}
          height={h}
          fill={fill}
          stroke={stroke}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      )}
      {shape.kind === 'ellipse' && (
        <ellipse
          data-vidi6="shape-body"
          cx={w / 2}
          cy={h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      )}
      {shape.kind === 'diamond' && (
        <polygon
          data-vidi6="shape-body"
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      )}
      <foreignObject x={0} y={0} width={w} height={h}>
        {editing && ytext ? (
          <ShapeLabelEditor
            ytext={ytext}
            onEndEdit={props.onEndEdit}
            onBoundary={props.onBoundary}
            onUndo={props.onUndo}
            onRedo={props.onRedo}
          />
        ) : (
          <div className="shape-label" data-vidi6="shape-label">
            {label}
          </div>
        )}
      </foreignObject>
    </svg>
  );
}
