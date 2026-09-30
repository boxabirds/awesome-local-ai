import { type ObjectSnapshot, isSticky, objectBounds } from '../../shared/board-model';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import { isConnector } from '../../shared/objects/connector';
import { isShape } from '../../shared/objects/shape';
import { isText } from '../../shared/objects/text';
import { unionRects } from '../../shared/geometry';
import { type Camera, worldToScreen } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { TextToolbar } from '../objects/TextToolbar';

export function selectionLabel(count: number): string {
  return `${count} selected`;
}

/**
 * The bar above the selection: "N selected" + Delete for two or more objects,
 * story 2's note toolbar for exactly one sticky note, the text toolbar (sizes)
 * for exactly one text object, the shape toolbar (fill and outline) for exactly
 * one shape, and Delete for exactly one arrow. The count is always
 * announced to screen readers through a polite live region.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Places the bar above the selection's bounding box. */
  camera?: Camera;
  /** Colour change for a single selected sticky note. */
  onColor?(id: string, color: StickyColor): void;
  /** Size change for a single selected text object. */
  onTextSize?(id: string, size: TextSize): void;
  /** Fill and/or outline change for a single selected shape. */
  onShapeStyle?(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
  /** Hides the visible bar (while dragging, editing, or when the board cannot be edited). */
  hidden?: boolean;
}): React.JSX.Element | null {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  const count = selected.length;
  const box = unionRects(selected.map(objectBounds));
  const anchor = box && props.camera ? worldToScreen(props.camera, { x: box.x + box.width / 2, y: box.y }) : null;
  const single = count === 1 ? selected[0] : undefined;

  let content: React.JSX.Element | null = null;
  if (!props.hidden && count >= 2) {
    content = (
      <div
        className="note-toolbar selection-bar"
        role="toolbar"
        aria-label="Selection"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <span className="selection-bar-count">{selectionLabel(count)}</span>
        <span className="note-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="note-toolbar-delete"
          aria-label="Delete selection"
          title="Delete selection"
          onClick={props.onDelete}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path
              d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3.5 0v8H15v-8h-1.5Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    );
  } else if (!props.hidden && single && isSticky(single)) {
    content = (
      <NoteToolbar color={single.color} onColor={(c) => props.onColor?.(single.id, c)} onDelete={props.onDelete} />
    );
  } else if (!props.hidden && single && isText(single)) {
    content = (
      <TextToolbar size={single.size} onSize={(s) => props.onTextSize?.(single.id, s)} onDelete={props.onDelete} />
    );
  } else if (!props.hidden && single && isShape(single)) {
    content = (
      <ShapeToolbar
        fill={single.fill}
        stroke={single.stroke}
        onFill={(fill) => props.onShapeStyle?.(single.id, { fill })}
        onStroke={(stroke) => props.onShapeStyle?.(single.id, { stroke })}
        onDelete={props.onDelete}
      />
    );
  } else if (!props.hidden && single && isConnector(single)) {
    content = (
      <div
        className="note-toolbar"
        role="toolbar"
        aria-label="Arrow"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <button type="button" className="note-toolbar-delete" aria-label="Delete arrow" title="Delete arrow" onClick={props.onDelete}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path
              d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3.5 0v8H15v-8h-1.5Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="visually-hidden" aria-live="polite" data-testid="selection-announcer">
        {count > 0 ? selectionLabel(count) : ''}
      </div>
      {content &&
        (anchor ? (
          <div className="note-toolbar-anchor" style={{ left: anchor.x, top: anchor.y }}>
            {content}
          </div>
        ) : (
          content
        ))}
    </>
  );
}
