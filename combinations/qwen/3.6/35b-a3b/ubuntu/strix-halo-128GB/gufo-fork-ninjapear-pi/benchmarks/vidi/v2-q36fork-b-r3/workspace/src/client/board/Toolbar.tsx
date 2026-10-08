import React from 'react';
import { UndoButtons } from './UndoButtons';

type ToolName = 'select' | 'sticky' | 'text' | 'shape' | 'connector';

interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  selectedTool?: ToolName;
  onToolChange?(tool: ToolName): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

const TOOL_INFO: Record<ToolName, { label: string; shortcut: string; emoji?: string }> = {
  select: { label: 'Select', shortcut: 'V' },
  sticky: { label: 'Sticky note', shortcut: 'N', emoji: '📝' },
  text: { label: 'Text', shortcut: 'T' },
  shape: { label: 'Shape', shortcut: 'S' },
  connector: { label: 'Connector', shortcut: 'L' },
};

export function Toolbar({
  onCreateSticky,
  disabled = false,
  selectedTool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
      }}
    >
      {(['select', 'sticky', 'text', 'shape', 'connector'] as ToolName[]).map((toolKey) => {
        const info = TOOL_INFO[toolKey];
        const isActive = selectedTool === toolKey;
        // For sticky button, create sticky AND switch to Select (legacy behaviour)
        const handleClick = () => {
          if (!disabled) {
            if (toolKey === 'sticky') {
              onCreateSticky();
            } else {
              onToolChange?.(toolKey);
            }
          }
        };
        return (
          <button
            key={toolKey}
            aria-label={`${info.label} (${info.shortcut})`}
            title={info.label + ' – or press ' + info.shortcut}
            aria-pressed={isActive}
            disabled={disabled}
            onClick={handleClick}
            style={{
              width: 40,
              height: 40,
              border: isActive ? '2px solid #2196F3' : 'none',
              borderRadius: 8,
              background: disabled ? '#eee' : (isActive ? '#e3f2fd' : '#fff'),
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: toolKey === 'sticky' ? 20 : 16,
              fontWeight: isActive ? 700 : 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: disabled ? '#999' : (isActive ? '#1565c0' : '#333'),
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {info.emoji || info.shortcut}
          </button>
        );
      })}
      <UndoButtons
        canUndo={canUndo}
        canRedo={canRedo}
        disabled={disabled}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    </div>
  );
}
