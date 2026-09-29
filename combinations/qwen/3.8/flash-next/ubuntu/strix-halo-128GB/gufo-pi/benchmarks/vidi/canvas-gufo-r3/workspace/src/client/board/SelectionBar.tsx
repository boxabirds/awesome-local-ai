import React from 'react';
import { ObjectSnapshot, objectBounds } from '@shared/board-model';
import { Camera } from '@client/canvas/camera';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete(): void;
}

/**
 * Shows "N selected" + Delete button when 2+ objects are selected.
 * When exactly one sticky is selected, NoteToolbar is shown instead (handled by StickyNote).
 * Rendered in screen space above the bounding box.
 */
export function SelectionBar({ ids, snapshot, camera, onDelete }: SelectionBarProps) {
  if (ids.size < 2) return null;

  // Compute bounding box of selected objects in world space
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of selected) {
    const b = objectBounds(obj);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }

  // Convert top-center of bounding box to screen space for positioning
  const screenTopLeftX = (minX - camera.x) * camera.zoom;
  const screenTopY = (minY - camera.y) * camera.zoom;
  const screenWidth = (maxX - minX) * camera.zoom;
  const centerX = screenTopLeftX + screenWidth / 2;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'absolute',
        left: centerX,
        top: screenTopY - 36,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '6px',
        padding: '4px 10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1000,
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        data-testid="selection-count"
        aria-live="polite"
        style={{ fontSize: '13px', color: '#333' }}
      >
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-button"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9h5.8l.6-9M6.5 6.5v4.5M9.5 6.5v4.5"
            fill="none"
            stroke="#444"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
