import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { TOOL_SHORTCUTS, useActiveTool } from '../../src/client/tools/useActiveTool';
import { drag, key, layer, shapes } from './shapeHelpers';

afterEach(cleanup);

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('active tool', () => {
  it('TC-22 the hook selects the created id and returns to Select', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useActiveTool({ onSelect }));
    expect(result.current.tool).toBe('select');
    expect(result.current.shapeKind).toBe('rect');
    for (const tool of ['shape', 'connector'] as const) {
      act(() => result.current.setTool(tool));
      expect(result.current.tool).toBe(tool);
      act(() => result.current.toolCreated('new-id'));
      expect(result.current.tool).toBe('select');
      expect(onSelect).toHaveBeenLastCalledWith('new-id');
    }
    act(() => result.current.setShapeKind('diamond'));
    expect(result.current.shapeKind).toBe('diamond');
  });

  it('every tool but Select is refused while the board cannot be edited', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: false }));
    act(() => result.current.setTool('shape'));
    expect(result.current.tool).toBe('select');
  });

  it('lists the cross-story shortcuts', () => {
    expect(TOOL_SHORTCUTS).toMatchObject({ v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector', p: 'pen', i: 'image', c: 'comment' });
  });

  it('S, L and V switch tools; the Shape menu appears only with the Shape tool', () => {
    render(<App />);
    expect(screen.queryByRole('group', { name: 'Shape kind' })).toBeNull();
    key('s');
    expect(pressed('Shape (S)')).toBe('true');
    expect(screen.getByRole('group', { name: 'Shape kind' })).toBeTruthy();
    key('l');
    expect(pressed('Connector (L)')).toBe('true');
    expect(pressed('Shape (S)')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Shape kind' })).toBeNull();
    key('v');
    expect(pressed('Select (V)')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    expect(pressed('Shape (S)')).toBe('true');
  });

  it('the shortcuts are ignored while typing in a label', () => {
    render(<App />);
    key('s');
    drag(layer(), [100, 100], [300, 220]);
    fireEvent.doubleClick(shapes()[0]);
    const editor = screen.getByRole('textbox');
    fireEvent.keyDown(editor, { key: 'l' });
    expect(pressed('Connector (L)')).toBe('false');
  });
});
