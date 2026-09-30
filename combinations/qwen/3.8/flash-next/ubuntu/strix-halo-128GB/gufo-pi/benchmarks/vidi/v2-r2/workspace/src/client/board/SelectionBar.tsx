import { type ReactElement } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import { unionRects } from '@shared/geometry';
import { type Camera, worldToScreen } from '@client/canvas/camera';
import { type StickyColor } from '@shared/config';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete(): void;
  // Story 2 compatibility: show NoteToolbar for single sticky
  showNoteToolbar?: boolean;
  selectedSticky?: { color: StickyColor; onColor(c: StickyColor): void } | null;
}

export function SelectionBar({
  ids,
  snapshot,
  camera,
  onDelete,
  showNoteToolbar = false,
  selectedSticky = null,
}: SelectionBarProps): ReactElement | null {
  if (ids.size === 0) return null;

  const selectedObjs = snapshot.filter((o) => ids.has(o.id));
  if (selectedObjs.length === 0) return null;

  // If exactly one sticky and showNoteToolbar, render NoteToolbar position hint
  if (ids.size === 1 && showNoteToolbar && selectedSticky) {
    return null; // NoteToolbar is handled by the parent for single sticky
  }

  // For 2+ selected, show "N selected" bar
  const rects = selectedObjs.map((o) => objectBounds(o));
  const boundingBox = unionRects(rects);
  if (!boundingBox) return null;

  const topLeft = worldToScreen(camera, { x: boundingBox.x, y: boundingBox.y });

  return (
    <div
      data-testid="selection-bar"
      aria-live="polite"
      data-board-ui="true"
      style={{
        position: 'fixed',
        left: topLeft.x,
        top: topLeft.y - 40,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: '#fff',
        borderRadius: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 31,
        fontSize: 13,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span data-testid="selection-count">{ids.size} selected</span>
      <button
        aria-label="Delete selection"
        data-testid="delete-selection-btn"
        onClick={onDelete}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
