// Story 7: the floating selection bar (anchor: sel.state).
//
// For a single selected sticky it renders the (existing) NoteToolbar so the
// colour swatches and per-note delete behave exactly as before (the e2e
// selectors target .note-toolbar). For a multi-selection it renders "N
// selected" and a Delete button (the exact PRD text/aria-labels). It floats
// above the group bounding box, in screen space, and tracks the board via the
// camera.

import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { setTextSize, type TextSnapshot } from '../../shared/objects/text';
import { unionRects } from '../../shared/geometry';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_STICKY_COLOR,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  STICKY_COLORS,
  type FillColor,
  type StrokeColor,
  type StickyColor,
} from '../../shared/config';
import { worldToScreen, type Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import type { ShapeSnap } from '../../shared/objects/shape';
import { setShapeStyle } from '../../shared/objects/shape';
import { sharedMeasurer } from '../objects/textLayout';
import { useTextBoxSync } from '../objects/useTextBoxSync';
import { useUndoController } from './useUndo';

function pickSelected(snapshot: readonly ObjectSnapshot[], ids: ReadonlySet<string>): ObjectSnapshot[] {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const out: ObjectSnapshot[] = [];
  for (const id of ids) {
    const o = byId.get(id);
    if (o !== undefined) out.push(o);
  }
  return out;
}

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  doc: Y.Doc;
  canEdit: boolean;
  /** Delete the current selection (a single note or the whole group). */
  onDelete: () => void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, camera, doc, canEdit, onDelete } = props;
  if (ids.size === 0) return null;
  const selected = pickSelected(snapshot, ids);
  if (selected.length === 0) return null;
  const box = unionRects(selected.map((o) => objectBounds(o)));
  if (box === null) return null;

  const anchor = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });

  const content =
    selected.length === 1 && selected[0].type === 'sticky' ? (
      <SingleStickyToolbar
        note={selected[0] as StickySnapshot}
        doc={doc}
        canEdit={canEdit}
        onDelete={onDelete}
      />
    ) : selected.length === 1 && selected[0].type === 'text' ? (
      <SingleTextToolbar
        text={selected[0] as TextSnapshot}
        doc={doc}
        canEdit={canEdit}
        onDelete={onDelete}
      />
    ) : selected.length === 1 && selected[0].type === 'shape' ? (
      <SingleShapeToolbar
        shape={selected[0] as ShapeSnap}
        doc={doc}
        canEdit={canEdit}
        onDelete={onDelete}
      />
    ) : (
      <div className="selection-bar" role="toolbar" aria-label="Selection tools">
        <span className="selection-bar__count" aria-live="polite">
          {selected.length} selected
        </span>
        <button
          type="button"
          className="selection-bar__delete"
          aria-label="Delete selection"
          disabled={!canEdit}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    );

  return (
    <div className="selection-bar-anchor" style={{ left: anchor.x, top: anchor.y }}>
      <div className="selection-bar-scaled">{content}</div>
    </div>
  );
}

/**
 * Story 9: the S/M/L/XL + Delete toolbar for one selected text object
 * (text.size). A size change keeps the top-left position, re-measures the box
 * (auto width re-measures, fixed width rewraps) and is one undo step.
 */
function SingleTextToolbar(props: {
  text: TextSnapshot;
  doc: Y.Doc;
  canEdit: boolean;
  onDelete(): void;
}): JSX.Element {
  const { text, doc, canEdit, onDelete } = props;
  const undo = useUndoController();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, text.id, sharedMeasurer());
  return (
    <TextToolbar
      size={text.size}
      onSize={(s) => {
        if (!canEdit) return;
        // Story 8: a size change is its own undo step; the box remeasure falls
        // in the same capture window, so undo reverts text size and box.
        undo?.boundary();
        if (setTextSize(doc, text.id, s)) remeasureAfterLocalChange();
        undo?.boundary();
      }}
      onDelete={onDelete}
    />
  );
}

/**
 * Story 10: the fill/outline swatches + Delete toolbar for one selected shape
 * (shape.style). A colour change is its own undo step.
 */
function SingleShapeToolbar(props: {
  shape: ShapeSnap;
  doc: Y.Doc;
  canEdit: boolean;
  onDelete: () => void;
}): JSX.Element {
  const { shape, doc, canEdit, onDelete } = props;
  const undo = useUndoController();
  const fill: FillColor = shape.fill in SHAPE_FILL_COLORS ? shape.fill : DEFAULT_SHAPE_FILL;
  const stroke: StrokeColor = shape.stroke in SHAPE_STROKE_COLORS ? shape.stroke : DEFAULT_SHAPE_STROKE;
  return (
    <ShapeToolbar
      fill={fill}
      stroke={stroke}
      onFill={(f) => {
        if (!canEdit) return;
        undo?.boundary();
        setShapeStyle(doc, shape.id, { fill: f });
        undo?.boundary();
      }}
      onStroke={(s) => {
        if (!canEdit) return;
        undo?.boundary();
        setShapeStyle(doc, shape.id, { stroke: s });
        undo?.boundary();
      }}
      onDelete={onDelete}
      disabled={!canEdit}
    />
  );
}

function SingleStickyToolbar(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  canEdit: boolean;
  onDelete: () => void;
}): JSX.Element {
  const { note, doc, canEdit, onDelete } = props;
  const color: StickyColor = note.color in STICKY_COLORS ? note.color : DEFAULT_STICKY_COLOR;
  // Story 8: a colour change is its own undo step (boundaries on both sides).
  const undo = useUndoController();
  return (
    <NoteToolbar
      color={color}
      onColor={(c) => {
        if (!canEdit) return;
        undo?.boundary();
        setStickyColor(doc, note.id, c);
        undo?.boundary();
      }}
      onDelete={onDelete}
      disabled={!canEdit}
    />
  );
}
