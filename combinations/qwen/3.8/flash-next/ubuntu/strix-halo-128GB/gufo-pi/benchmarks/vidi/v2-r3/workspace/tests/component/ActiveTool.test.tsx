import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveTool } from '../../src/client/tools/useActiveTool';

describe('active.tool (TC-22)', () => {
  it('TC-22: useActiveTool switches between select, sticky, shape, connector; one active at a time', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: true, onSelect: () => {} }));

    // Default: select
    expect(result.current.tool).toBe('select');

    // Switch to sticky
    act(() => { result.current.setTool('sticky'); });
    expect(result.current.tool).toBe('sticky');

    // Switch to shape
    act(() => { result.current.setTool('shape'); });
    expect(result.current.tool).toBe('shape');

    // Switch to connector
    act(() => { result.current.setTool('connector'); });
    expect(result.current.tool).toBe('connector');

    // Back to select
    act(() => { result.current.setTool('select'); });
    expect(result.current.tool).toBe('select');
  });

  it('TC-22: read-only locks non-select tools', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: false, onSelect: () => {} }));

    act(() => { result.current.setTool('shape'); });
    expect(result.current.tool).toBe('select'); // can't switch in read-only

    act(() => { result.current.setTool('connector'); });
    expect(result.current.tool).toBe('select'); // still select

    act(() => { result.current.setTool('text'); });
    expect(result.current.tool).toBe('select'); // still select
  });

  it('TC-22: toolCreated returns to select', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: true, onSelect: () => {} }));

    act(() => { result.current.setTool('shape'); });
    expect(result.current.tool).toBe('shape');

    act(() => { result.current.toolCreated('some-id'); });
    expect(result.current.tool).toBe('select');
  });
});
