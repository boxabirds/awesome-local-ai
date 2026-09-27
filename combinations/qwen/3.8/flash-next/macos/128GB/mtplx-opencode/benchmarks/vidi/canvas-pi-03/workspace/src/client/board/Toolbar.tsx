import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (load failure): the creation button
   * is rendered disabled, so the failure is visible instead of silent. */
  disabled?: boolean;
  /** The board's active tool (story 9). Omit for a palette with no tools. */
  tool?: Tool;
  /** Choose a tool from the palette. */
  onSelectTool?(tool: Tool): void;
}

/**
 * The fixed left-side tool palette: the two pointer tools and the sticky-note
 * creation button. It stops pointer propagation so a click in the palette never
 * reaches the board (which would otherwise clear the selection or pan the
 * camera).
 *
 * The tools are `aria-pressed` toggles rather than radio buttons: arming the
 * Text tool does not create anything, it changes what the next click on the
 * board means, which is what a pressed toggle button says.
 */
export function Toolbar({ onCreateSticky, disabled = false, tool = 'select', onSelectTool }: ToolbarProps) {
  const toolButton = (value: Tool, label: string, title: string, glyph: string) => {
    const active = tool === value;
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        disabled={disabled}
        data-disabled={disabled ? 'true' : 'false'}
        title={title}
        data-testid={`tool-${value}`}
        onClick={() => onSelectTool?.(value)}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: active ? '1px solid #2563eb' : '1px solid rgba(0,0,0,0.25)',
          borderRadius: 8,
          background: active ? '#DBEAFE' : '#ffffff',
          fontSize: 16,
          color: '#111',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {glyph}
      </button>
    );
  };

  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 6,
        background: '#ffffff',
        border: '1px solid rgba(17,17,17,0.12)',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      {toolButton('select', 'Select (V)', 'Select – or press Escape', '\u2191')}
      {toolButton('text', 'Text (T)', 'Text – or press T', 'T')}
      <button
        type="button"
        aria-label="Sticky note"
        aria-disabled={disabled}
        disabled={disabled}
        data-disabled={disabled ? 'true' : 'false'}
        title="Sticky note – or double-click the board"
        data-testid="create-sticky"
        onClick={() => onCreateSticky()}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          border: '1px solid rgba(0,0,0,0.25)',
          borderRadius: 8,
          background: '#FFF59D',
          fontSize: 20,
          color: '#111',
        }}
      >
        &#9634;
      </button>
    </div>
  );
}
