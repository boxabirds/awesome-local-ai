import type { CSSProperties, JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 8,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto'
};

const deleteStyle: CSSProperties = {
  height: 22,
  minWidth: 26,
  padding: '0 4px',
  border: '1px solid #d6dae1',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1
};

const countStyle: CSSProperties = {
  fontSize: 12,
  color: '#374151'
};

// The bar above a multi-selection's bounding box: count + delete. With fewer
// than two objects there is no bar (a single sticky shows the note toolbar
// instead). The single-sticky toolbar stays anchored by the object renderer,
// which is the only place that knows the object's colour and doc.
export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  if (props.ids.size < 2) return null;
  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
      style={barStyle}
      onPointerDown={(event) => {
        // Never let the bar pan the board or start a transform.
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      <span data-testid="selection-count" aria-live="polite" style={countStyle}>
        {props.ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection"
        style={deleteStyle}
        onClick={() => {
          props.onDelete();
        }}
      >
        🗑
      </button>
    </div>
  );
}
