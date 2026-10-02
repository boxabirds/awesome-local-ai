/**
 * Selection bar (story 7).
 *
 * The toolbar of a group: how many objects are selected and a bin for all of
 * them. It sits above the selection's bounding box in screen space, so it keeps
 * a readable size at every zoom level. With exactly one sticky note selected the
 * note's own toolbar (story 2) is shown instead.
 */
import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  /** A board that failed to load can be selected but not changed (story 4). */
  editable: boolean;
  onDelete(): void;
}

export function SelectionBar({ ids, snapshot, camera, editable, onDelete }: SelectionBarProps) {
  if (ids.size < 2) return null;

  const box = unionRects(
    snapshot.filter((obj) => ids.has(obj.id)).map((obj) => objectBounds(obj)),
  );
  if (!box) return null;

  const anchor = worldToScreen(camera, { x: box.x, y: box.y });

  return (
    <div
      data-testid="selection-bar"
      onPointerDown={(e) => {
        // The bar is never a reason to pan the board.
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        left: anchor.x,
        top: anchor.y - 12,
        transform: 'translateY(-100%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        backgroundColor: '#ffffff',
        border: '1px solid #dadce0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(60,64,67,0.3)',
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <span data-testid="selection-count" aria-live="polite" style={{ fontSize: 13, color: '#3c4043' }}>
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        disabled={!editable}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: editable ? 'pointer' : 'not-allowed',
          fontSize: 16,
          lineHeight: 1,
          padding: 2,
          color: '#5f6368',
          opacity: editable ? 1 : 0.4,
        }}
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}
