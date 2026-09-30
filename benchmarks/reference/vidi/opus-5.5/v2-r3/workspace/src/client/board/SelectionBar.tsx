import type { SyntheticEvent } from 'react';
import { isSticky, type ObjectSnapshot } from '../../shared/board-model';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import { isConnector } from '../../shared/objects/connector';
import { isShape } from '../../shared/objects/shape';
import { isText } from '../../shared/objects/text';
import { ConnectorToolbar, ShapeToolbar } from '../objects/ShapeToolbar';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';

function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

export function selectedLabel(count: number): string {
  return `${count} selected`;
}

/**
 * Above the selection: "N selected" and a Delete button for two or more
 * objects, story 2's note toolbar when exactly one sticky note is selected, or
 * story 9's text toolbar when exactly one text object is selected, or story 10's
 * shape or arrow toolbar for exactly one shape or arrow.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  onColor?(id: string, color: StickyColor): void;
  onTextSize?(id: string, size: TextSize): void;
  onShapeStyle?(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
}) {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  if (selected.length === 1) {
    const only = selected[0];
    if (isText(only)) {
      return <TextToolbar size={only.size} onSize={(s) => props.onTextSize?.(only.id, s)} onDelete={props.onDelete} />;
    }
    if (isShape(only)) {
      return (
        <ShapeToolbar
          fill={only.fill}
          stroke={only.stroke}
          onFill={(fill) => props.onShapeStyle?.(only.id, { fill })}
          onStroke={(stroke) => props.onShapeStyle?.(only.id, { stroke })}
          onDelete={props.onDelete}
        />
      );
    }
    if (isConnector(only)) return <ConnectorToolbar onDelete={props.onDelete} />;
    if (!isSticky(only)) return null;
    return (
      <NoteToolbar color={only.color} onColor={(c) => props.onColor?.(only.id, c)} onDelete={props.onDelete} />
    );
  }
  if (selected.length < 2) return null;
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="Selection"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      <span className="selection-count">{selectedLabel(selected.length)}</span>
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="note-delete"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M6 2h4M2.5 4h11M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 6.5v5M9.5 6.5v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Screen-reader announcement of the selection size ("N selected"); silent when empty. */
export function SelectionAnnouncer(props: { count: number }) {
  return (
    <div className="visually-hidden" aria-live="polite" data-testid="selection-announcer">
      {props.count > 0 ? selectedLabel(props.count) : ''}
    </div>
  );
}
