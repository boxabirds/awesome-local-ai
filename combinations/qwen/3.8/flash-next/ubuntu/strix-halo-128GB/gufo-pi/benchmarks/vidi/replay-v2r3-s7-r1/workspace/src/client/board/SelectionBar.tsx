import React, { useMemo } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { StickySnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import type { StickyColor } from '../../shared/config';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete(): void;
  /** For single sticky: colour handling */
  onColor?(id: string, color: StickyColor): void;
}

/**
 * Shows "N selected" with a Delete button when 2+ objects are selected,
 * or NoteToolbar when exactly one sticky note is selected.
 */
export function SelectionBar({ ids, snapshot, camera, onDelete, onColor }: SelectionBarProps) {
  const count = ids.size;

  // For single sticky, show NoteToolbar
  const singleSticky = useMemo(() => {
    if (count !== 1) return null;
    const id = [...ids][0];
    const obj = snapshot.find((o) => o.id === id);
    if (obj?.type === 'sticky') return obj as StickySnapshot;
    return null;
  }, [ids, count, snapshot]);

  if (count === 0) return null;

  if (count === 1 && singleSticky) {
    // NoteToolbar is rendered by StickyNote itself (anchor div), so we don't
    // render anything here for single-sticky case.
    return null;
  }

  if (count < 2) return null;

  // Compute position: above the bounding box of selected objects
  const selectedRects = snapshot
    .filter((o) => ids.has(o.id))
    .map((o) => objectBounds(o));
  const bbox = unionRects(selectedRects);
  if (!bbox) return null;

  const screenTopLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });

  return (
    <>
      <div
        data-testid="selection-bar"
        role="toolbar"
        aria-label="Selection toolbar"
        style={{
          position: 'absolute',
          left: screenTopLeft.x,
          top: screenTopLeft.y - 36,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#fff',
          borderRadius: 6,
          padding: '4px 8px',
          boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
          zIndex: 1000,
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span data-testid="selection-count">{count} selected</span>
        <button
          type="button"
          aria-label="Delete selection"
          data-testid="delete-selection-button"
          onClick={onDelete}
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: 'none',
            borderRadius: 6,
            background: 'none',
            color: '#5f6368',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3 4h10M6.5 4V2.8h3V4M4.4 4l.6 9.2h6L11.6 4M6.6 6.2v5M9.4 6.2v5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {/* aria-live region for screen reader announcement */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', left: -9999 }}>
        {count} selected
      </div>
    </>
  );
}
