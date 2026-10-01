import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TOOL_SHORTCUTS, useActiveTool } from '../../src/client/tools/useActiveTool';

describe('useActiveTool', () => {
  it('TC-22 toolCreated selects the new id and returns to Select for Shape and Connector', () => {
    const select = vi.fn();
    const { result } = renderHook(() => useActiveTool({ select }));
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('shape'));
    expect(result.current.tool).toBe('shape');
    act(() => result.current.toolCreated('s1'));
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('connector'));
    act(() => result.current.toolCreated('c1'));
    expect(result.current.tool).toBe('select');
    expect(select.mock.calls).toEqual([['s1'], ['c1']]);
  });

  it('keeps the shape kind and refuses drawing tools on a read-only board', () => {
    const { result, rerender } = renderHook(({ canEdit }) => useActiveTool({ canEdit }), { initialProps: { canEdit: true } });
    expect(result.current.shapeKind).toBe('rect');
    act(() => result.current.setShapeKind('diamond'));
    act(() => result.current.setTool('shape'));
    expect(result.current.shapeKind).toBe('diamond');
    rerender({ canEdit: false });
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('connector'));
    expect(result.current.tool).toBe('select');
  });

  it('maps single letters to tools', () => {
    expect(TOOL_SHORTCUTS).toMatchObject({ v: 'select', t: 'text', s: 'shape', l: 'connector' });
  });
});
