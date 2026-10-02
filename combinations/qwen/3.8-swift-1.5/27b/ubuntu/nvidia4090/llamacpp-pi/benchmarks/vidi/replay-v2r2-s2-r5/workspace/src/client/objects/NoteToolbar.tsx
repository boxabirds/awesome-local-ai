import { STICKY_COLORS, type StickyColor } from '../../shared/config';

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
      style={{
        position: 'absolute',
        top: '-44px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        backgroundColor: 'white',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        whiteSpace: 'nowrap',
        zIndex: 1000,
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          aria-label={`${c.charAt(0).toUpperCase() + c.slice(1)} colour`}
          aria-pressed={color === c}
          data-testid={`swatch-${c}`}
          onClick={() => onColor(c)}
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            border: color === c ? '2px solid #333' : '1px solid #ccc',
            backgroundColor: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        aria-label="Delete note"
        data-testid="delete-note-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '16px',
          padding: 0,
          marginLeft: '4px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
