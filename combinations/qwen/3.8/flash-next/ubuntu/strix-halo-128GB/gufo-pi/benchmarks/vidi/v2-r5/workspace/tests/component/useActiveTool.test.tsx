import { renderHook, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useActiveTool, TOOL_SHORTCUTS } from '../../src/client/tools/useActiveTool';

describe('tools.active_tool', () => {
  describe('TC-22: Tool shortcuts and return to Select', () => {
    it('S key activates shape tool', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      act(() => {
        fireEvent.keyDown(window, { key: 's' });
      });
      expect(result.current.tool).toBe('shape');
    });

    it('L key activates connector tool', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      act(() => {
        fireEvent.keyDown(window, { key: 'l' });
      });
      expect(result.current.tool).toBe('connector');
    });

    it('V key returns to select', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      act(() => {
        fireEvent.keyDown(window, { key: 's' });
      });
      expect(result.current.tool).toBe('shape');
      act(() => {
        fireEvent.keyDown(window, { key: 'v' });
      });
      expect(result.current.tool).toBe('select');
    });

    it('Escape with shape tool active returns to select', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      act(() => {
        fireEvent.keyDown(window, { key: 's' });
      });
      expect(result.current.tool).toBe('shape');
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(result.current.tool).toBe('select');
    });

    it('Escape with connector tool active returns to select', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      act(() => {
        fireEvent.keyDown(window, { key: 'l' });
      });
      expect(result.current.tool).toBe('connector');
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(result.current.tool).toBe('select');
    });

    it('toolCreated selects id and switches to select', () => {
      const onSelect = vi.fn();
      const { result } = renderHook(() => useActiveTool({ canEdit: true, onSelect }));
      act(() => {
        fireEvent.keyDown(window, { key: 's' });
      });
      expect(result.current.tool).toBe('shape');
      act(() => {
        result.current.toolCreated('new-shape-id');
      });
      expect(result.current.tool).toBe('select');
      expect(onSelect).toHaveBeenCalledWith('new-shape-id');
    });

    it('toolCreated from connector tool returns to select', () => {
      const onSelect = vi.fn();
      const { result } = renderHook(() => useActiveTool({ canEdit: true, onSelect }));
      act(() => {
        fireEvent.keyDown(window, { key: 'l' });
      });
      expect(result.current.tool).toBe('connector');
      act(() => {
        result.current.toolCreated('new-conn-id');
      });
      expect(result.current.tool).toBe('select');
      expect(onSelect).toHaveBeenCalledWith('new-conn-id');
    });

    it('shortcuts do not fire while typing in input', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      const input = document.createElement('input');
      document.body.appendChild(input);
      act(() => {
        fireEvent.keyDown(input, { key: 's' });
      });
      expect(result.current.tool).toBe('select');
      document.body.removeChild(input);
    });

    it('shortcuts do not fire when canEdit is false', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: false }));
      act(() => {
        fireEvent.keyDown(window, { key: 's' });
      });
      expect(result.current.tool).toBe('select');
    });

    it('shapeKind is rect by default and can be changed', () => {
      const { result } = renderHook(() => useActiveTool({ canEdit: true }));
      expect(result.current.shapeKind).toBe('rect');
      act(() => {
        result.current.setShapeKind('diamond');
      });
      expect(result.current.shapeKind).toBe('diamond');
    });

    it('TOOL_SHORTCUTS maps correctly', () => {
      expect(TOOL_SHORTCUTS['s']).toBe('shape');
      expect(TOOL_SHORTCUTS['l']).toBe('connector');
      expect(TOOL_SHORTCUTS['v']).toBe('select');
    });
  });
});
