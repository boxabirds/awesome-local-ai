// Story 10: one shape (anchor: shapes.object): render, select, move, resize,
// double-click to edit the label, fill/outline via the selection toolbar.
//
// Selection, move, nudge, resize, delete, marquee and undo come unchanged
// from stories 7/8 through the registry (shapes.move, shapes.consistent).
// The geometry is the stored rect; the kind (rectangle/ellipse/diamond) only
// changes the outline path. The label is a Y.Text (collaborative, undoable)
// fitted into the shape the way sticky note text is (story 2 pattern).

import { useLayoutEffect, useRef, useState } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { ShapeSnap } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { fitFontSize } from './StickyText';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, selected, editing } = props;
  const shape = obj as ShapeSnap;
  const undo = useUndoController();
  const labelRef = useRef<HTMLElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  const width = obj.width ?? SHAPE_DEFAULT_SIZE_WORLD;
  const height = obj.height ?? SHAPE_DEFAULT_SIZE_WORLD;
  const sw = SHAPE_STROKE_WIDTH_WORLD;

  // Fit the label into the shape (story 2 pattern: binary search on a live
  // element, deferred one frame so a large board mount does not thrash
  // layout). Empty labels need no fitting.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (el === null) return;
    if (shape.label === '') {
      setOverflow(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      const box = Math.max(
        SHAPE_LABEL_PADDING_WORLD,
        Math.min(width, height) - SHAPE_LABEL_PADDING_WORLD * 2,
      );
      const fit = fitFontSize(el, box);
      setOverflow(fit.overflow);
    });
    return () => cancelAnimationFrame(frame);
  }, [shape.label, width, height, editing]);

  // --- pointer: hand to the shared transform gesture (sel.transform) --------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns pointer events while editing
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // the board must not pan/marquee/create on a shape press
    props.onPointerDown(e);
  };

  // --- keyboard and label editing -------------------------------------------
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // the board must not create on a shape dblclick
    if (!editing && props.canEdit) props.onStartEdit(obj.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && !editing && props.canEdit) {
      e.preventDefault();
      props.onStartEdit(obj.id);
    }
  };

  const fill = shape.fill in SHAPE_FILL_COLORS ? shape.fill : DEFAULT_SHAPE_FILL;
  const stroke = shape.stroke in SHAPE_STROKE_COLORS ? shape.stroke : DEFAULT_SHAPE_STROKE;
  const ytext = getShapeLabel(props.doc, obj.id);

  return (
    <div
      className={`shape-object${overflow ? ' has-fade' : ''}`}
      data-testid="shape-object"
      data-shape-id={obj.id}
      data-shape-kind={shape.kind}
      data-selected={selected ? '' : undefined}
      role="group"
      aria-label={shape.label !== '' ? shape.label : 'Shape'}
      tabIndex={0}
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        fill: SHAPE_FILL_COLORS[fill],
        stroke: SHAPE_STROKE_COLORS[stroke],
        zIndex: obj.z,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <svg
        className="shape-object__svg"
        data-testid="shape-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
      >
        {shape.kind === 'rect' ? (
          <rect x={sw / 2} y={sw / 2} width={Math.max(0, width - sw)} height={Math.max(0, height - sw)} />
        ) : shape.kind === 'ellipse' ? (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={Math.max(0, (width - sw) / 2)}
            ry={Math.max(0, (height - sw) / 2)}
          />
        ) : (
          <polygon
            points={`${width / 2},${sw / 2} ${width - sw / 2},${height / 2} ${width / 2},${height - sw / 2} ${sw / 2},${height / 2}`}
          />
        )}
      </svg>
      {editing && ytext !== undefined ? (
        <div className="shape-object__editor">
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            width="auto"
            ariaLabel="Shape label"
            undo={undo}
            onEnd={() => props.onEndEdit(obj.id)}
          />
        </div>
      ) : (
        <div ref={(el) => void (labelRef.current = el)} className="shape-object__label">
          {shape.label}
        </div>
      )}
    </div>
  );
}
