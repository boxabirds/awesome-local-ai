// One shape object in the world layer: an SVG rect/ellipse/diamond sized to the
// object's world rect, stroked at SHAPE_STROKE_WIDTH_WORLD, with a centred,
// word-wrapping label backed by the label Y.Text. Double-click edits the label
// through the shared TextEditor (clamped to SHAPE_LABEL_MAX_CHARS); selection
// and drag go through the shared gesture so shapes behave like other objects.

import { SHAPE_FILL_COLORS, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD } from '../../shared/config';
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

const SHAPE_LABEL_FONT_WORLD = 16;

export type ShapeObjectProps = ObjectProps;

export function ShapeObject({
  obj,
  doc,
  selected,
  editing,
  editable,
  undo,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ShapeObjectProps): React.JSX.Element {
  const shape = obj as ShapeSnap;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? SHAPE_STROKE_COLORS.dark;
  const fill = SHAPE_FILL_COLORS[shape.fill] ?? SHAPE_FILL_COLORS.white;
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const inset = sw / 2;
  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;

  // Drawn in the object's own coordinate space (viewBox in world units); the
  // world layer's transform handles zoom, so the label needs no counter-scale.
  let element: React.JSX.Element;
  if (shape.kind === 'ellipse') {
    element = (
      <ellipse
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(0, width / 2 - inset)}
        ry={Math.max(0, height / 2 - inset)}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  } else if (shape.kind === 'diamond') {
    const pts = `${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`;
    element = <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />;
  } else {
    element = (
      <rect
        x={inset}
        y={inset}
        width={Math.max(0, width - sw)}
        height={Math.max(0, height - sw)}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  }

  return (
    <div
      role="group"
      aria-label={shape.label === '' ? 'Shape' : shape.label}
      data-testid="shape-object"
      data-shape-id={shape.id}
      data-shape-kind={shape.kind}
      data-selected={selected ? 'true' : 'false'}
      className="shape-object"
      tabIndex={0}
      style={
        {
          left: shape.x,
          top: shape.y,
          width,
          height,
          zIndex: shape.z,
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (editing) return;
        if (!editable) return;
        e.stopPropagation();
        onObjectPointerDown(e, shape.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) onStartEdit(shape.id);
      }}
    >
      <svg
        className="shape-object-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {element}
      </svg>
      {editing && editable && ytext ? (
        <div className="shape-label shape-label-editing">
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_WORLD}
            width={Math.max(1, width - sw * 2)}
            onInput={() => undefined}
            onEnd={onEndEdit}
            undo={undo}
            textareaTestId="shape-label"
            ariaLabel="Shape label"
          />
        </div>
      ) : (
        <div className="shape-label" data-testid="shape-label-text" style={{ fontSize: SHAPE_LABEL_FONT_WORLD }}>
          {shape.label}
        </div>
      )}
    </div>
  );
}
