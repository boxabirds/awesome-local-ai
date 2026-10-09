import type { ReactElement } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

/**
 * Story 9 (text.object): the toolbar for a single selected text object —
 * four size presets (S, M, L, XL) with the current size pressed, and Delete.
 * Rendered above the text's box by the SelectionBar.
 */
export function TextToolbar(props: {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}): ReactElement {
  return (
    <div
      className="text-toolbar"
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(TEXT_SIZES) as TextSize[]).map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          title={`${s} (${TEXT_SIZES[s]}px)`}
          aria-pressed={props.size === s}
          onClick={() => props.onSize(s)}
          style={{
            border: props.size === s ? '1px solid #1a73e8' : '1px solid #d5d9e0',
            borderRadius: 5,
            background: props.size === s ? '#e8f0fe' : '#fff',
            color: '#23272e',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: props.size === s ? 700 : 400,
            padding: '3px 7px',
            minWidth: 26,
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        title="Delete text"
        onClick={props.onDelete}
        style={{
          border: '1px solid #d5d9e0',
          borderRadius: 5,
          background: '#fff',
          color: '#b3261e',
          cursor: 'pointer',
          fontSize: 12,
          padding: '3px 8px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
