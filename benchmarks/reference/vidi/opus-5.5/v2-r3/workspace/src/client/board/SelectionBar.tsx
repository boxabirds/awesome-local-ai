import type { SyntheticEvent } from 'react';
import { isSticky, type ObjectSnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

export function selectedLabel(count: number): string {
  return `${count} selected`;
}

/**
 * Above the selection: "N selected" and a Delete button for two or more
 * objects, or story 2's note toolbar when exactly one sticky note is selected.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  onColor?(id: string, color: StickyColor): void;
}) {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  if (selected.length === 1) {
    const only = selected[0];
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
