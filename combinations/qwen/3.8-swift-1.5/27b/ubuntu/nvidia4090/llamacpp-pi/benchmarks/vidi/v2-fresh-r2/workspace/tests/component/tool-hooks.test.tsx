/**
 * Component tests for the active tool hook and tool shortcuts
 * (tools.active_tool contract). TC-15 and TC-16.
 */
import { describe, it, expect, vi } from 'vitest';
import { useMemo } from 'react';
import * as Y from 'yjs';
import { render, renderHook, act, fireEvent } from '@testing-library/react';
import { useTool, TOOL_SHORTCUTS, type ToolId } from '../../src/client/board/useTool';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { initDoc } from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('tools.active_tool', () => {
  // TC-15: S → shape; L → connector; V → select; text stays gated behind
  // the edit flag.
  it('TC-15: S/L/V shortcuts switch tools; text requires the edit flag', () => {
    const setTool = vi.fn();
    render(
      <Harness
        canEdit
        setTool={setTool}
      />,
    );

    fireEvent.keyDown(window, { key: 's' });
    expect(setTool).toHaveBeenLastCalledWith('shape');

    fireEvent.keyDown(window, { key: 'l' });
    expect(setTool).toHaveBeenLastCalledWith('connector');

    fireEvent.keyDown(window, { key: 'v' });
    expect(setTool).toHaveBeenLastCalledWith('select');

    // Text is available while editable.
    fireEvent.keyDown(window, { key: 't' });
    expect(setTool).toHaveBeenLastCalledWith('text');
  });

  it('TC-15: shortcuts are ignored when the board is not editable', () => {
    const setTool = vi.fn();
    render(<Harness canEdit={false} setTool={setTool} />);

    fireEvent.keyDown(window, { key: 't' });
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyDown(window, { key: 'l' });
    expect(setTool).not.toHaveBeenCalled();
  });

  // TOOL_SHORTCUTS maps the documented single letters.
  it('TOOL_SHORTCUTS maps the documented keys', () => {
    expect(TOOL_SHORTCUTS.v).toBe('select');
    expect(TOOL_SHORTCUTS.n).toBe('sticky');
    expect(TOOL_SHORTCUTS.t).toBe('text');
    expect(TOOL_SHORTCUTS.s).toBe('shape');
    expect(TOOL_SHORTCUTS.l).toBe('connector');
  });

  // TC-16: creating a shape/connector selects it and returns the tool to
  // select, even when the id is not in the snapshot yet.
  it('TC-16: toolCreated selects the new object and returns to select', () => {
    const objects: readonly ObjectSnapshot[] = [];
    const { result } = renderHook(() => {
      const selection = useSelection(objects);
      const tool = useTool({ canEdit: true, selection });
      return { tool, selection };
    });

    // Simulate drawing: switch to the shape tool…
    act(() => {
      result.current.tool.setTool('shape');
    });
    expect(result.current.tool.tool).toBe('shape');

    // …create an object (its id is not in the snapshot yet)…
    act(() => {
      result.current.tool.toolCreated('new-shape-id');
    });

    // …it is selected and the tool is back on select.
    expect(result.current.selection.ids.has('new-shape-id')).toBe(true);
    expect(result.current.tool.tool).toBe('select');
  });

  it('select() bypasses the presence check; click() does not', () => {
    const objects: readonly ObjectSnapshot[] = [];
    const { result } = renderHook(() => {
      const selection = useSelection(objects);
      const tool = useTool({ canEdit: true, selection });
      return { tool, selection };
    });

    act(() => {
      result.current.selection.click('missing');
    });
    expect(result.current.selection.ids.has('missing')).toBe(false);

    act(() => {
      result.current.selection.select('missing');
    });
    expect(result.current.selection.ids.has('missing')).toBe(true);
  });

  // shapeKind state: defaults to rect and changes with setShapeKind.
  it('shapeKind defaults to rect and is settable', () => {
    const { result } = renderHook(() => {
      const selection = useSelection([]);
      return useTool({ canEdit: true, selection });
    });

    expect(result.current.shapeKind).toBe('rect');
    act(() => {
      result.current.setShapeKind('diamond');
    });
    expect(result.current.shapeKind).toBe('diamond');
  });

  // setTool is a no-op for tools without a mode in this build.
  it('setTool ignores tools without a mode (image/comment)', () => {
    const { result } = renderHook(() => {
      const selection = useSelection([]);
      return useTool({ canEdit: true, selection });
    });

    act(() => {
      result.current.setTool('image' as ToolId);
    });
    expect(result.current.tool).toBe('select');

    act(() => {
      result.current.setTool('comment' as ToolId);
    });
    expect(result.current.tool).toBe('select');
  });

  // Pen is now a valid tool mode (story 11).
  it('setTool accepts pen as a valid tool mode', () => {
    const { result } = renderHook(() => {
      const selection = useSelection([]);
      return useTool({ canEdit: true, selection });
    });

    act(() => {
      result.current.setTool('pen' as ToolId);
    });
    expect(result.current.tool).toBe('pen');
  });
});

/** Harness that wires useBoardKeys to a mock setTool. */
function Harness(props: { canEdit: boolean; setTool: (tool: ToolId) => void }) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, []);
  const objects = useMemo(() => [] as readonly ObjectSnapshot[], []);
  const selection = useSelection(objects);
  useBoardKeys({
    doc,
    objects,
    selection,
    canEdit: props.canEdit,
    startEdit: selection.startEdit,
    tool: { setTool: props.setTool },
  });
  return null;
}
