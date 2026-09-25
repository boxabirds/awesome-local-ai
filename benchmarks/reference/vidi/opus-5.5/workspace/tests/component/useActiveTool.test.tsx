/**
 * tools.active_tool (story 10): the active tool hook, S / L / Escape, and return to Select after
 * creating (TC-22).
 */
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TOOL_SHORTCUTS, useActiveTool } from '../../src/client/tools/useActiveTool';
import {
  addShape,
  arrows,
  centre,
  connectorTool,
  dragOn,
  selectedIds,
  shapes,
  shapeTool,
  toolPressed,
  toScreen,
} from './shapeHelpers';
import { renderBoard } from './stickyHelpers';
import { pressKey } from './textHelpers';

describe('tools.active_tool useActiveTool', () => {
  it('starts on Select with Rectangle; shortcuts table; toolCreated selects and returns to Select', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useActiveTool({ onSelect }));
    expect(result.current.tool).toBe('select');
    expect(result.current.shapeKind).toBe('rect');
    expect(TOOL_SHORTCUTS).toMatchObject({ v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector' });
    act(() => result.current.setTool('shape'));
    act(() => result.current.setShapeKind('ellipse'));
    expect(result.current).toMatchObject({ tool: 'shape', shapeKind: 'ellipse' });
    act(() => result.current.toolCreated('new-id'));
    expect(onSelect).toHaveBeenCalledWith('new-id');
    expect(result.current.tool).toBe('select');
    // Tools not in this build are ignored.
    act(() => result.current.setTool('image'));
    expect(result.current.tool).toBe('select');
  });

  it('while the board cannot be edited only Select is available', () => {
    const { result, rerender } = renderHook(({ canEdit }) => useActiveTool({ canEdit }), {
      initialProps: { canEdit: true },
    });
    act(() => result.current.setTool('connector'));
    rerender({ canEdit: false });
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('shape'));
    expect(result.current.tool).toBe('select');
  });
});

describe('tools.active_tool on the board', () => {
  it('TC-22 S then create, L then create: Select active after each, new item selected', () => {
    renderBoard();
    pressKey('s');
    dragOn(shapeTool(), { x: 200, y: 200 }, { x: 200, y: 200 });
    expect(toolPressed('Select (V)')).toBe('true');
    const shape = shapes()[0]!;
    expect(selectedIds()).toEqual([shape.id]);

    pressKey('l');
    expect(toolPressed('Connector (L)')).toBe('true');
    dragOn(connectorTool(), toScreen(centre(shape)), toScreen({ x: shape.x + 600, y: shape.y }));
    expect(toolPressed('Select (V)')).toBe('true');
    expect(selectedIds()).toEqual([arrows()[0]!.id]);
  });

  it('TC-22 S then Escape and L then Escape: Select, nothing created; Escape mid-drag drops the gesture (negative)', () => {
    renderBoard();
    addShape({ x: 0, y: 0, width: 100, height: 100 });
    pressKey('s');
    pressKey('Escape');
    expect(toolPressed('Select (V)')).toBe('true');
    pressKey('l');
    pressKey('Escape');
    expect(toolPressed('Select (V)')).toBe('true');

    pressKey('s');
    fireEvent.pointerDown(shapeTool(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(shapeTool(), { pointerId: 1, clientX: 300, clientY: 300 });
    pressKey('Escape');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, button: 0, clientX: 300, clientY: 300 });
    expect(shapes()).toHaveLength(1);
    expect(arrows()).toHaveLength(0);
  });

  it('the Shape and Connector buttons switch tools; the Shape menu offers Rectangle, Ellipse and Diamond', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    expect(toolPressed('Shape (S)')).toBe('true');
    const items = screen.getAllByRole('menuitemradio').map((i) => [i.textContent, i.getAttribute('aria-checked')]);
    expect(items).toEqual([
      ['Rectangle', 'true'],
      ['Ellipse', 'false'],
      ['Diamond', 'false'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Connector (L)' }));
    expect(toolPressed('Connector (L)')).toBe('true');
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });
});
