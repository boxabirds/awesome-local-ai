// Selection bar (story 7): floats above the selection's bounding box.
// - Exactly one sticky note: the sticky note toolbar (colour + delete).
// - Two or more objects: "N selected" (announced via aria-live) + Delete.
// Rendered in screen space as a sibling of the viewport inside .app-root.

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { DEFAULT_TEXT_SIZE, type StickyColor, type TextSize, type FillColor, type StrokeColor } from '../../shared/config';

const BAR_GAP_PX = 8;

export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete: () => void;
  onStickyColor: (id: string, color: StickyColor) => void;
  /** Change the size of a text object (story 9). */
  onTextSize?: (id: string, size: TextSize) => void;
  /** Change the fill of a shape (story 10). */
  onShapeFill?: (id: string, fill: FillColor) => void;
  /** Change the stroke of a shape (story 10). */
  onShapeStroke?: (id: string, stroke: StrokeColor) => void;
}): React.ReactElement | null {
  const { ids, snapshot, camera, onDelete, onStickyColor, onTextSize, onShapeFill, onShapeStroke } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  const box = unionRects(selected.map(objectBounds));
  if (box === null) return null;

  const tl = worldToScreen(camera, { x: box.x, y: box.y });
  const cx = tl.x + (box.width * camera.zoom) / 2;
  const anchorTop = tl.y - BAR_GAP_PX;

  // Exactly one sticky note → the classic note toolbar.
  if (ids.size === 1 && selected[0].type === 'sticky') {
    const obj = selected[0];
    return (
      <div
        data-testid="selection-bar"
        style={{
          position: 'absolute',
          left: cx,
          top: anchorTop,
          pointerEvents: 'auto',
          zIndex: 30,
        }}
      >
        <NoteToolbar
          color={obj.color ?? 'yellow'}
          onColor={(c) => onStickyColor(obj.id, c)}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // Exactly one text object → the text toolbar (story 9).
  if (ids.size === 1 && selected[0].type === 'text') {
    const obj = selected[0];
    const size = (obj.size as TextSize | undefined) ?? DEFAULT_TEXT_SIZE;
    return (
      <div
        data-testid="selection-bar"
        style={{
          position: 'absolute',
          left: cx,
          top: anchorTop,
          pointerEvents: 'auto',
          zIndex: 30,
        }}
      >
        <TextToolbar
          size={size}
          onSize={(s) => onTextSize?.(obj.id, s)}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // Exactly one shape → the shape toolbar (story 10).
  if (ids.size === 1 && selected[0].type === 'shape') {
    const obj = selected[0] as ObjectSnapshot & { fill: string; stroke: string };
    return (
      <div
        data-testid="selection-bar"
        style={{
          position: 'absolute',
          left: cx,
          top: anchorTop,
          pointerEvents: 'auto',
          zIndex: 30,
        }}
      >
        <ShapeToolbar
          fill={(obj.fill ?? 'white') as FillColor}
          stroke={(obj.stroke ?? 'dark') as StrokeColor}
          onFill={(c) => onShapeFill?.(obj.id, c)}
          onStroke={(c) => onShapeStroke?.(obj.id, c)}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // Two or more → count + delete.
  return (
    <div
      data-testid="selection-bar"
      style={{
        position: 'absolute',
        left: cx,
        top: anchorTop,
        transform: 'translate(-50%, -100%)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
        zIndex: 30,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span data-testid="selection-count" aria-live="polite">
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🗑
      </button>
    </div>
  );
}
