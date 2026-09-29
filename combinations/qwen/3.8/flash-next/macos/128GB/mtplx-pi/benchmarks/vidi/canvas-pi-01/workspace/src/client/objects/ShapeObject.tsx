/**
 * Story 10 · task 12 — the shape object (design "ShapeObject", PRD
 * `shape.create_drag`, `shape.label`, `shape.style`).
 *
 * One shape is an absolutely positioned `div[role=group]` in the (scaled) world
 * layer at world `(x, y)`, sized from its own `width` / `height`. Inside it:
 *
 *  - an SVG holding the actual geometry — `rect`, `ellipse` or a diamond
 *    `polygon` — drawn with the chosen fill and outline at
 *    `SHAPE_STROKE_WIDTH_WORLD`;
 *  - a centred label layer over the whole box. It is plain HTML rather than an
 *    SVG `foreignObject` because the box *is* the label's wrapping area: the
 *    text re-wraps and stays centred when the shape is resized with no
 *    shape-specific layout code (PRD `shape.label`).
 *
 * Pointer behaviour comes from the same {@link useObjectInteraction} hook as the
 * sticky note and free text, so a shape is selected, moved and group-resized
 * with no new transform code, and its footprint is the bounding box (the
 * registry's `rectangularHitTest`).
 */
import { useEffect, type JSX } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';
import { useObjectInteraction } from './useObjectInteraction';
import type { TransformController } from '../board/transformController';
import type { UndoController } from '../board/undo';

export interface ShapeObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False on a read-only board: no drag, no label editing, no recolouring. */
  editable?: boolean;
  controller: TransformController;
  undo?: UndoController;
  selection: readonly string[];
  onSelect(id: string, additive: boolean): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Change the fill and/or outline (the parent runs it in one undo step). */
  onStyle?(style: { fill?: string; stroke?: string }): void;
  onDelete(id: string): void;
}

/** Padding between the label and the shape's bounding box, in world units. */
const PADDING = 10;

/** The label's font size in world units (it scales with the board). */
const LABEL_FONT_WORLD = 16;

/** Look a colour token up in its map, falling back to the default. */
function fillColor(token: string): string {
  return (SHAPE_FILL_COLORS as Record<string, string>)[token] ?? SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL];
}

function strokeColor(token: string): string {
  return (
    (SHAPE_STROKE_COLORS as Record<string, string>)[token] ?? SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE]
  );
}

/** The geometry element for a kind, sized to the box (stroke drawn centred). */
export function shapeElement(
  kind: string,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
): JSX.Element {
  const inset = strokeWidth / 2;
  const common = { fill, stroke, strokeWidth } as const;
  if (kind === 'ellipse') {
    return (
      <ellipse
        data-testid="shape-geometry"
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(0, width / 2 - inset)}
        ry={Math.max(0, height / 2 - inset)}
        {...common}
      />
    );
  }
  if (kind === 'diamond') {
    const points = `${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${
      height - inset
    } ${inset},${height / 2}`;
    return <polygon data-testid="shape-geometry" points={points} {...common} />;
  }
  return (
    <rect
      data-testid="shape-geometry"
      x={inset}
      y={inset}
      width={Math.max(0, width - strokeWidth)}
      height={Math.max(0, height - strokeWidth)}
      {...common}
    />
  );
}

export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, editing, onSelect, onStartEdit } = props;
  const { id, x, y } = obj;
  const kind = obj.kind ?? 'rect';
  const fill = obj.fill ?? DEFAULT_SHAPE_FILL;
  const stroke = obj.stroke ?? DEFAULT_SHAPE_STROKE;
  const label = obj.text ?? '';
  const width = obj.width || 1;
  const height = obj.height || 1;
  const editable = props.editable ?? true;

  const interaction = useObjectInteraction({
    id,
    isEditable: () => editable,
    isEditing: () => editing,
    getSelection: () => props.selection,
    onSelect: (objId, additive) => onSelect(objId, additive),
    getController: () => props.controller,
  });

  // A shape deleted mid-gesture (locally or by a teammate) simply ends the
  // interaction: there is nothing left to move.
  useEffect(() => {
    if (getShapeLabel(doc, id) === undefined) interaction.onPointerEnd({} as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, id, label]);

  const onDoubleClick = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!editable) return;
    if (!editing) onStartEdit(id);
  };

  const groupSize = props.selection.length;
  const showToolbar =
    selected && groupSize <= 1 && !editing && interaction.phase === 'idle' && editable;
  const inverse = zoom > 0 ? 1 / zoom : 1;
  const ytext = editing ? getShapeLabel(doc, id) : undefined;

  return (
    <div
      role="group"
      aria-label={label.length > 0 ? `${kind} shape: ${label}` : `${kind} shape`}
      data-testid={`shape-${id}`}
      data-shape-id={id}
      data-kind={kind}
      data-phase={interaction.phase}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-x={x}
      data-y={y}
      data-width={width}
      data-height={height}
      tabIndex={0}
      className="shape-object"
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'auto',
        touchAction: 'none',
        outline: selected ? '2px solid #2f6fed' : 'none',
      }}
      onPointerDown={interaction.onPointerDown}
      onPointerMove={interaction.onPointerMove}
      onPointerUp={interaction.onPointerEnd}
      onPointerCancel={interaction.onPointerEnd}
      onLostPointerCapture={interaction.onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      <svg
        data-testid="shape-svg"
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {shapeElement(
          kind,
          width,
          height,
          fillColor(fill),
          strokeColor(stroke),
          SHAPE_STROKE_WIDTH_WORLD,
        )}
      </svg>

      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          initial={label}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          box={Math.max(1, width - PADDING * 2)}
          padding={PADDING}
          fontPx={LABEL_FONT_WORLD}
          onEnd={props.onEndEdit}
          undo={props.undo}
          ariaLabel="Shape label"
          testId={`shape-editor-${id}`}
        />
      ) : (
        <div
          className="shape-label"
          data-testid="shape-label"
          style={{
            position: 'absolute',
            inset: `${PADDING}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            fontSize: `${LABEL_FONT_WORLD}px`,
            lineHeight: 1.3,
            color: '#1c2430',
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
      )}

      {showToolbar ? (
        <div
          className="shape-toolbar-anchor"
          style={{
            position: 'absolute',
            top: `${-44 * inverse}px`,
            left: '0px',
            transform: `scale(${inverse})`,
            transformOrigin: 'top left',
            pointerEvents: 'auto',
          }}
        >
          <ShapeToolbar
            fill={fill}
            stroke={stroke}
            onFill={(next) => {
              if (!editable) return;
              props.onStyle?.({ fill: next });
            }}
            onStroke={(next) => {
              if (!editable) return;
              props.onStyle?.({ stroke: next });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
