import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../../src/client/board/Toolbar';
import { TOOL_SHORTCUTS, useActiveTool } from '../../src/client/tools/useActiveTool';

afterEach(cleanup);

describe('useActiveTool', () => {
  it('TC-22 toolCreated selects the new id and returns to Select', () => {
    const select = vi.fn();
    const { result } = renderHook(() => useActiveTool({ select }));
    for (const tool of ['shape', 'connector'] as const) {
      act(() => result.current.setTool(tool));
      expect(result.current.tool).toBe(tool);
      act(() => result.current.toolCreated(`id-${tool}`));
      expect(result.current.tool).toBe('select');
      expect(select).toHaveBeenLastCalledWith(`id-${tool}`);
    }
  });

  it('starts on Select with the rectangle kind, which the menu can change', () => {
    const { result } = renderHook(() => useActiveTool());
    expect([result.current.tool, result.current.shapeKind]).toEqual(['select', 'rect']);
    act(() => result.current.setShapeKind('ellipse'));
    expect(result.current.shapeKind).toBe('ellipse');
  });

  it('falls back to Select when the board stops being editable', () => {
    const { result, rerender } = renderHook(({ canEdit }) => useActiveTool({ canEdit }), { initialProps: { canEdit: true } });
    act(() => result.current.setTool('shape'));
    rerender({ canEdit: false });
    expect(result.current.tool).toBe('select');
  });

  it('keeps the cross-story shortcut table', () => {
    expect(TOOL_SHORTCUTS).toMatchObject({ v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector' });
  });
});

describe('Toolbar shape and connector buttons', () => {
  it('Shape opens a kind menu with Rectangle selected; Connector shows its pressed state', () => {
    const onTool = vi.fn();
    const onShapeKind = vi.fn();
    const { rerender } = render(<Toolbar onCreateSticky={() => {}} tool="select" onTool={onTool} onShapeKind={onShapeKind} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    expect(onTool).toHaveBeenCalledWith('shape');
    rerender(<Toolbar onCreateSticky={() => {}} tool="shape" onTool={onTool} onShapeKind={onShapeKind} />);
    expect(screen.getAllByRole('menuitemradio').map((b) => [b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['Rectangle', 'true'], ['Ellipse', 'false'], ['Diamond', 'false'],
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    expect(onShapeKind).toHaveBeenCalledWith('diamond');
    rerender(<Toolbar onCreateSticky={() => {}} tool="connector" onTool={onTool} />);
    expect(screen.getByRole('button', { name: 'Connector (L)' }).getAttribute('aria-pressed')).toBe('true');
  });
});
