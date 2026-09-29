// Story 10 (tools.shortcuts) component tests: TC-22.
//
// A minimal harness mounts the useActiveTool hook (the same options the
// Board passes) and exposes the resulting tool/shapeKind as test ids, so
// the plain-key shortcuts can be driven against window directly.

import { act, screen } from '@testing-library/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useActiveTool } from '../../src/client/tools/useActiveTool';

function key(type: string, props: Record<string, unknown> = {}): Event {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
}

function windowKey(e: Event): boolean {
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

interface HarnessProps {
  canEdit?: boolean;
  editing?: boolean;
}

function Harness({ canEdit = true, editing = false }: HarnessProps): React.ReactElement {
  const api = useActiveTool({
    canEdit,
    isEditing: () => editing,
    select: () => {},
  });
  return (
    <div>
      <span data-testid="tool">{api.tool}</span>
      <span data-testid="shape-kind">{api.shapeKind}</span>
      <button type="button" onClick={() => api.setShapeKind('diamond')}>
        setDiamond
      </button>
    </div>
  );
}

describe('story 10: tool shortcuts (tools.shortcuts)', () => {
  it('TC-22: V → select, T → text, S → shape, L → connector, Escape → select; S keeps the previous kind', () => {
    const { unmount } = render(<Harness />);
    const toolEl = () => screen.getByTestId('tool');
    const kindEl = () => screen.getByTestId('shape-kind');

    // Defaults.
    expect(toolEl().textContent).toBe('select');
    expect(kindEl().textContent).toBe('rect');

    // T → text.
    windowKey(key('keydown', { key: 't' }));
    expect(toolEl().textContent).toBe('text');

    // V → select.
    windowKey(key('keydown', { key: 'v' }));
    expect(toolEl().textContent).toBe('select');

    // S → shape.
    windowKey(key('keydown', { key: 's' }));
    expect(toolEl().textContent).toBe('shape');

    // L → connector.
    windowKey(key('keydown', { key: 'l' }));
    expect(toolEl().textContent).toBe('connector');

    // Escape → select.
    windowKey(key('keydown', { key: 'Escape' }));
    expect(toolEl().textContent).toBe('select');

    // Switching shape kinds is independent of the tool.
    act(() => {
      screen.getByRole('button', { name: 'setDiamond' }).click();
    });
    expect(kindEl().textContent).toBe('diamond');

    // S again: the kind is kept (the previous kind is retained).
    windowKey(key('keydown', { key: 's' }));
    expect(toolEl().textContent).toBe('shape');
    expect(kindEl().textContent).toBe('diamond');
    unmount();
  });

  it('TC-22 (negative): shortcuts are inactive while editing; non-editable board ignores creation tools', () => {
    // While a text editor is open, S must not switch the tool.
    const editing = render(<Harness editing />);
    windowKey(key('keydown', { key: 's' }));
    expect(screen.getByTestId('tool').textContent).toBe('select');
    editing.unmount();

    // A non-editable board ignores creation tools (tools.not_editable).
    const locked = render(<Harness canEdit={false} />);
    windowKey(key('keydown', { key: 's' }));
    expect(screen.getByTestId('tool').textContent).toBe('select');
    windowKey(key('keydown', { key: 'l' }));
    expect(screen.getByTestId('tool').textContent).toBe('select');
    // V (select) still works on a locked board.
    windowKey(key('keydown', { key: 't' }));
    expect(screen.getByTestId('tool').textContent).toBe('select');
    locked.unmount();
  });
});
