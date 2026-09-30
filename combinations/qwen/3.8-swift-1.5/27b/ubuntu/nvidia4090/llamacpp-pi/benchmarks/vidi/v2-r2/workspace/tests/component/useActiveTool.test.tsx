/**
 * Component tests for the active tool hook (story 10, tools.active_tool).
 * TC-22.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveTool } from '../../src/client/tools/useActiveTool';

describe('useActiveTool (TC-22)', () => {
  afterEach(() => {
    // Clean up any event listeners
    window.removeEventListener('keydown', () => {});
  });

  it('TC-22: S then create → Select active; L then create → Select active; S then Escape → Select; L then Escape → Select', () => {
    const onToolCreated = vi.fn();
    const { result } = renderHook(() => useActiveTool({ onToolCreated, canEdit: true }));

    // Initial state: select
    expect(result.current.tool).toBe('select');

    // Press S → shape tool
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });
    expect(result.current.tool).toBe('shape');

    // Create a shape → should return to select
    act(() => {
      result.current.toolCreated('shape-1');
    });
    expect(result.current.tool).toBe('select');
    expect(onToolCreated).toHaveBeenCalledWith('shape-1');

    // Press L → connector tool
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
    });
    expect(result.current.tool).toBe('connector');

    // Create a connector → should return to select
    act(() => {
      result.current.toolCreated('conn-1');
    });
    expect(result.current.tool).toBe('select');
    expect(onToolCreated).toHaveBeenCalledWith('conn-1');

    // Press S → shape tool
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });
    expect(result.current.tool).toBe('shape');

    // Escape → select (nothing created)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.tool).toBe('select');
    // No creation should have happened
    expect(onToolCreated).not.toHaveBeenCalledWith(expect.any(String), expect.any(String));

    // Press L → connector tool
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
    });
    expect(result.current.tool).toBe('connector');

    // Escape → select (nothing created)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.tool).toBe('select');
  });

  it('V shortcut returns to select', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: true }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });
    expect(result.current.tool).toBe('shape');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(result.current.tool).toBe('select');
  });

  it('shapeKind state works', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: true }));

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
