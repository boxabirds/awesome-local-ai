import { act, cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useActiveTool, TOOL_SHORTCUTS } from '../../src/client/tools/useActiveTool';
import { down, key, objectsOf, pressed, renderBoard, up } from './shapes-helpers';

afterEach(cleanup);

describe('tools.active_tool', () => {
  it('toolCreated selects the new id and returns to Select', () => {
    const select = vi.fn();
    const { result } = renderHook(() => useActiveTool({ select }));
    act(() => result.current.setTool('shape'));
    expect(result.current.tool).toBe('shape');
    act(() => result.current.toolCreated('abc'));
    expect(select).toHaveBeenCalledWith('abc');
    expect(result.current.tool).toBe('select');
    act(() => result.current.setShapeKind('diamond'));
    expect(result.current.shapeKind).toBe('diamond');
  });

  it('creating tools need an editable board', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: false }));
    act(() => result.current.setTool('connector'));
    expect(result.current.tool).toBe('select');
  });

  it('maps the single-letter shortcuts', () => {
    expect(TOOL_SHORTCUTS).toMatchObject({ v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector', p: 'pen', i: 'image', c: 'comment' });
  });

  it('TC-22 S then create and L then create return to Select; Escape returns to Select and creates nothing', () => {
    const { doc } = renderBoard();
    key('s');
    expect(pressed('Shape (S)')).toBe('true');
    down(screen.getByTestId('shape-tool-layer'), 200, 200);
    up(screen.getByTestId('shape-tool-layer'), 200, 200);
    expect(pressed('Select (V)')).toBe('true');
    expect(objectsOf(doc, 'shape')).toHaveLength(1);

    key('l');
    expect(pressed('Connector (L)')).toBe('true');
    down(screen.getByTestId('connector-tool-layer'), 600, 600);
    up(screen.getByTestId('connector-tool-layer'), 800, 600);
    expect(pressed('Select (V)')).toBe('true');
    expect(objectsOf(doc, 'connector')).toHaveLength(1);

    key('s');
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    key('l');
    down(screen.getByTestId('connector-tool-layer'), 100, 100);
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('connector-tool-layer')).toBeNull();
    expect(objectsOf(doc, 'shape')).toHaveLength(1);
    expect(objectsOf(doc, 'connector')).toHaveLength(1);
  });

  it('the toolbar buttons switch tools and the shape menu lists the three kinds', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    expect(['Rectangle', 'Ellipse', 'Diamond'].map((n) => screen.getByRole('menuitemradio', { name: n }).getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: 'Connector (L)' }));
    expect(pressed('Connector (L)')).toBe('true');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
