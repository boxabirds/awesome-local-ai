import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete(): void;
}

/**
 * Shows "N selected" + Delete button when ≥ 2 objects are selected.
 * Positioned above the bounding box in screen space.
 */
export function SelectionBar({ ids, snapshot, camera, onDelete }: SelectionBarProps) {
  if (ids.size < 2) return null;

  const rects = snapshot.filter((o) => ids.has(o.id)).map(objectBounds);
  const bbox = unionRects(rects);
  if (!bbox) return null;

  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y - 36,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 6,
        padding: '4px 8px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <span data-testid="selection-count" style={{ fontSize: 13, whiteSpace: 'nowrap', color: '#333' }}>
        {ids.size} selected
      </span>
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
          borderRadius: 4,
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
  );
}

/**
 * Aria-live region that announces the selection count to screen readers.
 */
export function SelectionAnnouncement({ count }: { count: number }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="selection-announcement"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
    >
      {count > 0 ? `${count} selected` : ''}
    </div>
  );
}
