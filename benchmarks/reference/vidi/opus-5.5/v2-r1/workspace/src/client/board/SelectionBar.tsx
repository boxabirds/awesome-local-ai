// "N selected" bar with a Delete button above the selection, or the note toolbar when exactly one
// sticky note is selected (story 7), the text toolbar when exactly one text is (story 9), or the
// shape toolbar when exactly one shape is (story 10). The count is also announced to screen readers.
import type { SyntheticEvent } from 'react';
import { type ObjectSnapshot, isSticky } from '../../shared/board-model';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import { isShape } from '../../shared/objects/shape';
import { isText } from '../../shared/objects/text';
import type { Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { selectedObjects, selectionScreenBox } from './SelectionOverlay';

const stop = (e: SyntheticEvent) => e.stopPropagation();

export function selectedLabel(count: number): string {
  return `${count} selected`;
}

export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Positions the bar above the selection; without it the bar is not positioned. */
  camera?: Camera;
  /** Colour change from the single-note toolbar. */
  onColor?(id: string, color: StickyColor): void;
  /** Size change from the single-text toolbar (story 9). */
  onTextSize?(id: string, size: TextSize): void;
  /** Fill or outline change from the single-shape toolbar (story 10). */
  onShapeStyle?(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
  /** False while the board is locked: no note toolbar, Delete disabled. */
  editable?: boolean;
  /** Hides the bar (not the announcement) while dragging or editing. */
  hidden?: boolean;
}) {
  const objects = selectedObjects(props.ids, props.snapshot);
  const count = objects.length;
  const editable = props.editable ?? true;
  const box = props.camera ? selectionScreenBox(props.ids, props.snapshot, props.camera) : null;
  const anchorStyle = box ? { left: box.x + box.width / 2, top: box.y } : undefined;

  let bar = null;
  if (!props.hidden && count === 1 && isSticky(objects[0]) && editable) {
    const note = objects[0];
    bar = (
      <div className="selection-bar-anchor" style={anchorStyle}>
        <NoteToolbar
          color={note.color}
          onColor={(c) => props.onColor?.(note.id, c)}
          onDelete={props.onDelete}
        />
      </div>
    );
  } else if (!props.hidden && count === 1 && isText(objects[0]) && editable) {
    const text = objects[0];
    bar = (
      <div className="selection-bar-anchor" style={anchorStyle}>
        <TextToolbar
          size={text.size}
          onSize={(s) => props.onTextSize?.(text.id, s)}
          onDelete={props.onDelete}
        />
      </div>
    );
  } else if (!props.hidden && count === 1 && isShape(objects[0]) && editable) {
    const shape = objects[0];
    bar = (
      <div className="selection-bar-anchor" style={anchorStyle}>
        <ShapeToolbar
          fill={shape.fill}
          stroke={shape.stroke}
          onFill={(fill) => props.onShapeStyle?.(shape.id, { fill })}
          onStroke={(stroke) => props.onShapeStyle?.(shape.id, { stroke })}
          onDelete={props.onDelete}
        />
      </div>
    );
  } else if (!props.hidden && count >= 2) {
    bar = (
      <div className="selection-bar-anchor" style={anchorStyle}>
        <div
          className="selection-bar note-toolbar"
          role="toolbar"
          aria-label="Selection"
          onPointerDown={stop}
          onPointerUp={stop}
          onDoubleClick={stop}
        >
          <span className="selection-bar-count">{selectedLabel(count)}</span>
          <span className="note-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="note-toolbar-delete"
            aria-label="Delete selection"
            title="Delete selection"
            disabled={!editable}
            onClick={props.onDelete}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="visually-hidden" aria-live="polite" data-testid="selection-status">
        {count > 0 ? selectedLabel(count) : ''}
      </div>
      {bar}
    </>
  );
}
