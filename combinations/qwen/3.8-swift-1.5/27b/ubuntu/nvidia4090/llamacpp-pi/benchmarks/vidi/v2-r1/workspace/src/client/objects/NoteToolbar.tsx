import { STICKY_COLORS, type StickyColor } from '@shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor: (c: StickyColor) => void;
  onDelete: () => void;
}

const COLOR_NAMES: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="note-toolbar"
      onPointerDown={handlePointerDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          aria-label={`${c} colour`}
          aria-pressed={color === c}
          data-testid={`swatch-${c}`}
          onClick={() => onColor(c)}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: color === c ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
            backgroundColor: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        aria-label="Delete note"
        data-testid="delete-note"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          border: 'none',
          background: 'transparent',
          fontSize: 16,
          cursor: 'pointer',
          marginLeft: 4,
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
