import type { JSX } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { setStickyColor } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { setTextSize, toTextSnapshot } from '../../shared/objects/text';
import { worldToScreen, type Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';

/**
 * The bar above the selection's bounding box (sel.bar):
 * - two or more objects → "N selected" + a Delete button
 *   (`aria-label="Delete selection"`), announced via `aria-live="polite"`;
 * - exactly one sticky note → story 2's NoteToolbar (colours + delete)
 *   instead, floating above the note in screen space;
 * - exactly one text object → story 9's TextToolbar (size presets + delete);
 * - otherwise → nothing.
 *
 * `doc` and `camera` extend the sel.interaction contract so the single-note
 * toolbar can change colours and position itself (see NOTES.md).
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  camera: Camera;
  onDelete(): void;
  /** Story 8: boundary callback for undo step isolation. */
  onBoundary?(): void;
}): JSX.Element | null {
  const { ids, snapshot, doc, camera, onDelete, onBoundary } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  // Exactly one text object: story 9's text toolbar (sizes + delete).
  if (selected.length === 1 && selected[0].type === 'text') {
    const t = toTextSnapshot(selected[0]);
    if (t) {
      const bounds = objectBounds(t);
      const topCentre = worldToScreen(camera, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y,
      });
      return (
        <div
          data-testid="selection-bar-anchor"
          style={{
            position: 'fixed',
            left: topCentre.x,
            top: topCentre.y,
            transform: 'translate(-50%, calc(-100% - 6px))',
            zIndex: 6,
          }}
        >
          <TextToolbar
            size={t.size}
            onSize={(s) => {
              onBoundary?.();
              setTextSize(doc, t.id, s);
              onBoundary?.();
            }}
            onDelete={onDelete}
          />
        </div>
      );
    }
  }

  // Exactly one sticky note: story 2's note toolbar instead of the bar.
  if (selected.length === 1 && selected[0].type === 'sticky') {
    const note = selected[0];
    const bounds = objectBounds(note);
    const topCentre = worldToScreen(camera, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y,
    });
    return (
      <div
        data-testid="selection-bar-anchor"
        style={{
          position: 'fixed',
          left: topCentre.x,
          top: topCentre.y,
          transform: 'translate(-50%, calc(-100% - 6px))',
          zIndex: 6,
        }}
      >
        <NoteToolbar
          color={note.color ?? 'yellow'}
          onColor={(c) => {
            onBoundary?.();
            setStickyColor(doc, note.id, c);
            onBoundary?.();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        ...barPosition(selected, camera),
      }}
    >
      <span data-testid="selection-count" aria-live="polite">
        {selected.length} selected
      </span>
      <button
        type="button"
        data-testid="delete-selection-button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        🗑️
      </button>
    </div>
  );
}

/** Places the bar centred above the selection's bounding box (screen space). */
function barPosition(
  selected: ObjectSnapshot[],
  camera: Camera,
): React.CSSProperties {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  for (const o of selected) {
    const b = objectBounds(o);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
  }
  const top = worldToScreen(camera, { x: (x1 + x2) / 2, y: y1 });
  return {
    left: top.x,
    top: top.y,
    transform: 'translate(-50%, calc(-100% - 6px))',
  };
}
