import type { JSX } from 'react';
import { TextToolbar } from '../objects/TextToolbar';
import type { TextSize } from '../../shared/config';

/**
 * SelectionBar: "N selected" + Delete button when 2+ objects are selected.
 * When exactly one text object is selected, the TextToolbar appears.
 * When exactly one sticky is selected, the NoteToolbar appears (rendered by
 * the note component).
 */
export interface SelectionBarProps {
  /** Number of selected objects. */
  count: number;
  /** Whether to show the bar (only when count >= 2). */
  onDelete(): void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  if (props.count < 2) return null;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection"
      style={{
        position: 'absolute',
        top: -36,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        border: '1px solid #ddd',
        borderRadius: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        whiteSpace: 'nowrap',
        fontSize: 13,
        zIndex: 20,
      }}
    >
      <span aria-live="polite" data-testid="selection-count">
        {props.count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection"
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
          alignItems: 'center',
        }}
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 7.5h5L10 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Shown when exactly one text object is selected. */
export interface TextSelectionBarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

export function TextSelectionBar(props: TextSelectionBarProps): JSX.Element {
  return (
    <div
      data-testid="text-selection-bar"
      style={{
        position: 'absolute',
        top: -36,
        left: 0,
        pointerEvents: 'auto',
        zIndex: 30,
      }}
    >
      <TextToolbar size={props.size} onSize={props.onSize} onDelete={props.onDelete} />
    </div>
  );
}