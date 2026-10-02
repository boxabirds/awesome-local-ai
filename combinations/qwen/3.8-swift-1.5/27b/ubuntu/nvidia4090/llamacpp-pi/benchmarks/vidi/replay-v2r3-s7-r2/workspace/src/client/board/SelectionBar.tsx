import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot, type StickySnapshot } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

/**
 * Selection bar (story 7, sel.selection_bar).
 *
 * - Exactly one sticky note selected → story 2's NoteToolbar above it
 *   (hidden while that note is being edited).
 * - Two or more objects selected → a bar above the selection's bounding box:
 *   "N selected" (announced via an aria-live region) and a Delete button.
 */

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  editingId: string | null;
  onDelete(): void;
  onColor?(c: StickyColor): void;
}

export function SelectionBar({
  ids,
  snapshot,
  camera,
  editingId,
  onDelete,
  onColor,
}: SelectionBarProps): React.ReactElement | null {
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  // Single sticky → the story 2 note toolbar (not while editing).
  if (selected.length === 1) {
    const o = selected[0];
    if (o.type !== 'sticky') return null;
    if (editingId === o.id) return null;
    const note = o as StickySnapshot;
    const tl = worldToScreen(camera, { x: note.x, y: note.y });
    const w = (o.width ?? STICKY_SIZE_WORLD) * camera.zoom;
    return (
      <div
        style={{
          position: 'fixed',
          left: tl.x + w / 2,
          top: tl.y - 8,
          transform: 'translate(-50%, -100%)',
          zIndex: 30,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <NoteToolbar color={note.color} onColor={onColor ?? (() => {})} onDelete={onDelete} />
      </div>
    );
  }

  // Two or more → the multi-selection bar.
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const tl = worldToScreen(camera, { x: box.x, y: box.y });
  const w = box.width * camera.zoom;
  const n = selected.length;

  return (
    <div
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: tl.x + w / 2,
        top: tl.y - 8,
        transform: 'translate(-50%, -100%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(255, 255, 255, 0.96)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 12px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        color: '#222',
      }}
    >
      <span data-testid="selection-count" aria-live="polite">
        {n} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
        style={{
          border: '1px solid #c8c8c8',
          borderRadius: 6,
          background: '#fff',
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        <span aria-hidden>🗑</span>
      </button>
    </div>
  );
}
