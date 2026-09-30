import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import { objectBounds, setStickyColor, type ObjectSnapshot, type StickySnapshot } from '../../shared/board-model';
import { setTextSize, type TextSnapshot } from '../../shared/objects/text';
import { unionRects } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { createCanvasMeasurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';

/**
 * Selection action bar (story 7, sel.ui). Exactly one sticky → the story-2
 * note toolbar (colours + delete) above the note. Two or more selected → a
 * small "N selected" bar with a delete button above the selection's bounding
 * box. Hidden with no selection. (The contract is extended with `camera` and
 * `doc` for screen-space positioning and the colour actions — see NOTES.md.)
 */
export function SelectionBar({
  ids,
  snapshot,
  camera,
  doc,
  onDelete,
}: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  doc: Y.Doc;
  onDelete(): void;
}): ReactElement | null {
  if (ids.size === 0) return null;

  const measure = useMemo(() => createCanvasMeasurer(), []);

  // Exactly one object: the type-specific toolbar (sticky colours or text
  // sizes) above the object.
  if (ids.size === 1) {
    const id = [...ids][0];
    const obj = snapshot.find((o) => o.id === id);
    if (!obj) return null;
    const b = objectBounds(obj);
    const topCenter = worldToScreen(camera, { x: b.x + b.width / 2, y: b.y });
    const wrapperStyle: React.CSSProperties = {
      position: 'absolute',
      left: topCenter.x,
      top: topCenter.y,
      transform: 'translate(-50%, -100%) translateY(-6px)',
      zIndex: 950,
    };

    if (obj.type === 'sticky') {
      const note = obj as StickySnapshot;
      return (
        <div style={wrapperStyle}>
          <NoteToolbar
            color={note.color}
            onColor={(c) => setStickyColor(doc, note.id, c)}
            onDelete={onDelete}
          />
        </div>
      );
    }

    if (obj.type === 'text') {
      const text = obj as TextSnapshot;
      return (
        <div style={wrapperStyle} onPointerDown={(e) => e.stopPropagation()}>
          <TextToolbar
            currentSize={text.size}
            onSizeChange={(size) => {
              setTextSize(doc, text.id, size);
              remeasureTextBox(doc, text.id, measure);
            }}
            onDelete={onDelete}
          />
        </div>
      );
    }

    return null;
  }

  // Two or more: count + delete bar.
  const rects = snapshot.filter((o) => ids.has(o.id)).map(objectBounds);
  const bounds = unionRects(rects);
  if (!bounds) return null;
  const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });

  return (
    <div
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y,
        transform: 'translateY(-100%) translateY(-8px)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
        whiteSpace: 'nowrap',
        zIndex: 950,
      }}
    >
      <span data-testid="selection-count" aria-live="polite" style={{ fontSize: 12 }}>
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        onClick={onDelete}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 4,
          padding: '2px 4px',
          cursor: 'pointer',
          color: '#374151',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6" />
        </svg>
      </button>
    </div>
  );
}
