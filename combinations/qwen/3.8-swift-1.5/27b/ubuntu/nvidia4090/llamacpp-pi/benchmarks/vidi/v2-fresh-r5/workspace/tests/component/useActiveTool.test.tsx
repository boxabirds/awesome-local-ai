import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveTool } from '../../src/client/tools/useActiveTool';

describe('useActiveTool', () => {
  // TC-22: S then create, L then create → Select active; S then Escape, L then Escape → Select active and nothing created (negative).
  it('TC-22: toolCreated switches to select', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, onSelect })
    );

    // Initially select
    expect(result.current.tool).toBe('select');

    // Switch to shape
    act(() => {
      result.current.setTool('shape');
    });
    expect(result.current.tool).toBe('shape');

    // Simulate creation
    act(() => {
      result.current.toolCreated('new-id');
    });
    expect(result.current.tool).toBe('select');
    expect(onSelect).toHaveBeenCalledWith('new-id');

    // Switch to connector
    act(() => {
      result.current.setTool('connector');
    });
    expect(result.current.tool).toBe('connector');

    // Simulate creation
    act(() => {
      result.current.toolCreated('arrow-id');
    });
    expect(result.current.tool).toBe('select');
    expect(onSelect).toHaveBeenCalledWith('arrow-id');
  });

  it('TC-22b: Escape from shape/connector returns to select', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, onSelect })
    );

    // Switch to shape
    act(() => {
      result.current.setTool('shape');
    });
    expect(result.current.tool).toBe('shape');

    // Press Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.tool).toBe('select');

    // Switch to connector
    act(() => {
      result.current.setTool('connector');
    });
    expect(result.current.tool).toBe('connector');

    // Press Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.tool).toBe('select');
  });

  it('TC-22c: keyboard shortcuts switch tools', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, onSelect })
    );

    // Press S for shape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });
    expect(result.current.tool).toBe('shape');

    // Press L for connector
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
    });
    expect(result.current.tool).toBe('connector');

    // Press V for select
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(result.current.tool).toBe('select');
  });

  it('TC-22d: shapeKind state works', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, onSelect })
    );

    expect(result.current.shapeKind).toBe('rect');

    act(() => {
      result.current.setShapeKind('ellipse');
    });
    expect(result.current.shapeKind).toBe('ellipse');

    act(() => {
      result.current.setShapeKind('diamond');
    });
    expect(result.current.shapeKind).toBe('diamond');
  });
});
