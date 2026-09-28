/**
 * Selection bar (story 7): a small floating toolbar shown when the selection is
 * non-empty. Positioning follows the camera so it sits just above the selection
 * at any zoom / pan. Currently offers Delete; later stories add more commands.
 */
import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { useBoardCamera } from '../canvas/BoardViewport';
import { worldToScreen } from '../canvas/camera';
import { selectionBounds } from './selectionBounds';

export function SelectionBar(props: {
  count: number;
  snapshot: readonly ObjectSnapshot[];
  ids: ReadonlySet<string>;
  onDelete(): void;
  hidden?: boolean;
}): JSX.Element | null {
  const { camera } = useBoardCamera();
  if (props.count <= 0 || props.hidden) return null;
  const bounds = selectionBounds(props.ids, props.snapshot);
  if (!bounds) return null;
  const top = worldToScreen(camera, { x: bounds.x + bounds.width / 2, y: bounds.y });

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      style={{
        position: 'absolute',
        left: `${top.x}px`,
        top: `${top.y - 40}px`,
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
      }}
    >
      <span className="selection-count" aria-live="polite" data-testid="selection-count">
        {props.count} selected
      </span>
      <button
        type="button"
        className="selection-delete"
        data-testid="selection-delete"
        onClick={props.onDelete}
      >
        Delete
      </button>
    </div>
  );
}
