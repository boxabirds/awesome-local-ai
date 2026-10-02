import React from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { unionRects } from '../../shared/geometry';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete(): void;
  onBringToFront(): void;
}

const BAR_GAP_PX = 10;

/**
 * Floating action bar for a multi-object selection (sel.bar): bring to front,
 * delete, and a count. Self-positions in screen space, centred above the top of
 * the selection's bounding box. A polite live region announces the count even
 * when the visible bar is hidden (selections under two stay as before).
 */
export function SelectionBar({ ids, snapshot, camera, onDelete, onBringToFront }: SelectionBarProps) {
  const count = ids.size;
  const selected = snapshot.filter((o) => ids.has(o.id));
  const bbox = unionRects(selected.map(objectBounds));

  let anchor: { left: number; top: number } | null = null;
  if (bbox) {
    const p = worldToScreen(camera, { x: bbox.x + bbox.width / 2, y: bbox.y });
    anchor = { left: p.x, top: p.y - BAR_GAP_PX };
  }

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" data-testid="selection-count-live">
        {count === 0 ? 'Nothing selected' : `${count} objects selected`}
      </div>
      {count >= 2 && anchor && (
        <div
          data-testid="selection-bar"
          role="toolbar"
          aria-label="Selection actions"
          style={{
            position: 'fixed',
            left: anchor.left,
            top: anchor.top,
            transform: 'translate(-50%, -100%)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 4,
            backgroundColor: '#fff',
            border: '1px solid #d0d0d0',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10,
          }}
        >
          <span data-testid="selection-bar-count" style={{ padding: '0 6px', fontSize: 13 }}>
            {count} selected
          </span>
          <button type="button" data-testid="bring-to-front" onClick={onBringToFront}>
            Bring to front
          </button>
          <button type="button" data-testid="delete-selection" onClick={onDelete}>
            Delete selection
          </button>
        </div>
      )}
    </>
  );
}
