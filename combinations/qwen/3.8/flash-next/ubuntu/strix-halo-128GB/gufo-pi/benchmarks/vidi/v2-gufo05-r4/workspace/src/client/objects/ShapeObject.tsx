/**
 * A shape on the board (`shape.ui`): an outline with optional words in the middle.
 *
 * It borrows almost everything — pressing, selecting, moving, marqueeing, resizing, deleting
 * and undoing are story 7's and story 8's code, reached through the registry. What is its own:
 *
 *  - **the outline is the object.** A rectangle, ellipse or diamond is drawn as one SVG element
 *    sized to the stored box, with a stroke of `SHAPE_STROKE_WIDTH_WORLD` board units so it
 *    scales with the board rather than thickening when you zoom. The stroke is drawn *inside*
 *    the box (inset by half its width), so a shape's outline never reaches past the rectangle
 *    that selects it;
 *  - **the label is centred in the box and wraps to it.** Because the label box is the shape's
 *    own width and height, resizing re-wraps the words and they stay in the middle — which is
 *    what you want from a shape in a diagram, where the box is the thing being pointed at and
 *    the words are its name;
 *  - **the colour is a name.** The fill and the outline are looked up in the palettes, so this
 *    component never sees a hex in the document.
 *
 * Typing into the label is the same editor a sticky note and free text use, with the shape's
 * limits passed in. The design asks for the editor in an SVG `foreignObject`; the label lives
 * in a plain layer above the SVG instead, which is how the note and the text box already do it
 * and keeps one editor working in three places (see NOTES.md).
 */

import {
  useCallback,
  useRef,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import {
  NOTE_TOOLBAR_GAP_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_LINE_HEIGHT
} from '../../shared/config';
import { getShapeLabel, setShapeStyle, type ShapeSnap } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import type { ObjectComponentProps } from './registry';
import { ShapeToolbar } from './ShapeToolbar';
import { TextEditor } from './TextEditor';

export function ShapeObject(props: ObjectComponentProps): JSX.Element {
  const { object, bounds, doc, zoom, selected, editing: editingProp, onStartEdit, onEndEdit } = props;
  const canEdit = props.canEdit !== false;
  // A board that has just become unwritable must not keep an open label editor either.
  const editing = editingProp && canEdit;

  const shape = object as ShapeSnap;
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;
  const fill = SHAPE_FILL_COLORS[shape.fill] ?? 'transparent';
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? '#000000';

  const latest = useRef({ doc, canEdit, id: object.id });
  latest.current = { doc, canEdit, id: object.id };

  // A colour change is its own undo step, bounded on both sides so it does not merge with the
  // drag or the typing before it (`undo.steps`).
  const undoController = useUndoController();

  const handleFill = useCallback(
    (colour: string) => {
      const current = latest.current;
      if (!current.canEdit) return;
      undoController?.boundary();
      setShapeStyle(current.doc, current.id, { fill: colour });
      undoController?.boundary();
    },
    [undoController]
  );

  const handleStroke = useCallback(
    (colour: string) => {
      const current = latest.current;
      if (!current.canEdit) return;
      undoController?.boundary();
      setShapeStyle(current.doc, current.id, { stroke: colour });
      undoController?.boundary();
    },
    [undoController]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Editing owns the pointer: a click inside the label places the caret.
      if (editing) {
        event.stopPropagation();
        return;
      }
      props.gesture.onObjectPointerDown(event, object.id);
    },
    [editing, object.id, props.gesture]
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click on a shape names that shape rather than drawing another one.
      event.stopPropagation();
      if (editing || !canEdit) return;
      onStartEdit(object.id);
    },
    [canEdit, editing, object.id, onStartEdit]
  );

  const stopPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const boxStyle: CSSProperties = {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height
  };

  /** The shape's own drawing area, the label box inside it: the label never escapes the outline. */
  const labelStyle: CSSProperties = {
    padding: `${SHAPE_LABEL_PADDING_WORLD}px`,
    fontSize: `${SHAPE_LABEL_FONT_WORLD}px`
  };

  const toolbarStyle: CSSProperties = {
    bottom: `calc(100% + ${NOTE_TOOLBAR_GAP_WORLD}px)`,
    transform: `scale(${1 / (zoom || 1)})`
  };

  const ytext = editing ? getShapeLabel(doc, object.id) : undefined;
  const interaction = props.transforming === true ? 'dragging' : editing ? 'editing' : 'idle';

  return (
    <div
      className="vidi6-shape"
      data-vidi6="shape"
      data-object-id={object.id}
      data-object-type={object.type}
      data-shape-id={object.id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-x={bounds.x}
      data-y={bounds.y}
      data-width={bounds.width}
      data-height={bounds.height}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      role="group"
      aria-label={shape.label !== '' ? shape.label : `${shape.kind} shape`}
      tabIndex={0}
      style={boxStyle}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        className="vidi6-shape-svg"
        data-testid="shape-svg"
        width={bounds.width}
        height={bounds.height}
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {shape.kind === 'ellipse' ? (
          <ellipse
            cx={bounds.width / 2}
            cy={bounds.height / 2}
            rx={Math.max(bounds.width / 2 - strokeWidth / 2, 0)}
            ry={Math.max(bounds.height / 2 - strokeWidth / 2, 0)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ) : shape.kind === 'diamond' ? (
          <polygon
            points={[
              `${bounds.width / 2},${strokeWidth / 2}`,
              `${bounds.width - strokeWidth / 2},${bounds.height / 2}`,
              `${bounds.width / 2},${bounds.height - strokeWidth / 2}`,
              `${strokeWidth / 2},${bounds.height / 2}`
            ].join(' ')}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ) : (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(bounds.width - strokeWidth, 0)}
            height={Math.max(bounds.height - strokeWidth, 0)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
      </svg>

      {editing && ytext ? (
        <div className="vidi6-shape-edit" data-testid="shape-edit" style={labelStyle} onPointerDown={stopPointer}>
          <TextEditor
            ytext={ytext}
            fontPx={SHAPE_LABEL_FONT_WORLD}
            lineHeight={TEXT_LINE_HEIGHT}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            className="vidi6-shape-input"
            testId="shape-input"
            ariaLabel="Shape label"
            emptyPlaceholder="Label"
            outsideSelector='[data-vidi6="shape"]'
            widthPx={Math.max(bounds.width - SHAPE_LABEL_PADDING_WORLD * 2, 1)}
            onEnd={onEndEdit}
          />
        </div>
      ) : (
        <div className="vidi6-shape-label" data-testid="shape-label" style={labelStyle}>
          {shape.label}
        </div>
      )}

      {selected && props.selectedCount === 1 && !editing && interaction === 'idle' ? (
        <div className="vidi6-shape-toolbar-anchor" style={toolbarStyle}>
          <ShapeToolbar
            fill={shape.fill}
            stroke={shape.stroke}
            onFill={handleFill}
            onStroke={handleStroke}
            disabled={!canEdit}
          />
        </div>
      ) : null}
    </div>
  );
}
