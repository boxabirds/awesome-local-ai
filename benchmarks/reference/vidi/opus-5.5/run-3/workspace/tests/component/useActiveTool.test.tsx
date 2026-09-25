import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { TOOL_SHORTCUTS, useActiveTool } from '../../src/client/tools/useActiveTool';
import { key, pointer, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const button = (name: string) => screen.getByRole('button', { name });

describe('active tool and return to Select (tools.active_tool)', () => {
  it('has the cross-story shortcut table', () => {
    expect(TOOL_SHORTCUTS).toEqual({
      v: 'select',
      n: 'sticky',
      t: 'text',
      s: 'shape',
      l: 'connector',
      p: 'pen',
      i: 'image',
      c: 'comment',
    });
  });

  it('TC-22 S or L then create returns to Select; S or L then Escape returns to Select and creates nothing', () => {
    const doc = freshDoc();
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });

    expect(key('s', document.body)).toBe(true);
    expect(button('Shape (S)')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'false');
    const shapeSurface = screen.getByTestId('shape-tool');
    pointer(shapeSurface, 'down', 100, 100);
    pointer(shapeSurface, 'up', 100, 100);
    expect(objectSnapshot(doc)).toHaveLength(1);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Shape (S)')).toHaveAttribute('aria-pressed', 'false');

    expect(key('L', document.body)).toBe(true);
    expect(button('Connector (L)')).toHaveAttribute('aria-pressed', 'true');
    const connectorSurface = screen.getByTestId('connector-tool');
    pointer(connectorSurface, 'down', 400, 400);
    pointer(connectorSurface, 'move', 500, 450);
    pointer(connectorSurface, 'up', 500, 450);
    expect(objectSnapshot(doc)).toHaveLength(2);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    const arrow = objectSnapshot(doc).find((o) => o.type === 'connector')!;
    expect(window.__vidi6!.selection!()).toEqual([arrow.id]);

    key('s', document.body);
    key('Escape', document.body);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    key('l', document.body);
    key('Escape', document.body);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(objectSnapshot(doc)).toHaveLength(2);
    // Escape leaving a tool keeps the selection.
    expect(window.__vidi6!.selection!()).toEqual([arrow.id]);

    // The toolbar buttons do the same as the keys.
    act(() => button('Connector (L)').click());
    expect(button('Connector (L)')).toHaveAttribute('aria-pressed', 'true');
    act(() => button('Shape (S)').click());
    expect(button('Shape (S)')).toHaveAttribute('aria-pressed', 'true');
    key('v', document.body);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
  });

  it('the hook: letters for tools not in this build and keys typed into a text field are ignored', () => {
    let current: ReturnType<typeof useActiveTool> | null = null;
    function Probe() {
      current = useActiveTool();
      return <input aria-label="Field" />;
    }
    render(<Probe />);
    expect(key('p', document.body)).toBe(false);
    expect(key('i', document.body)).toBe(false);
    expect(current!.tool).toBe('select');
    expect(key('s', screen.getByLabelText('Field'))).toBe(false);
    expect(current!.tool).toBe('select');
    key('s', document.body);
    expect(current!.tool).toBe('shape');
    act(() => current!.setShapeKind('ellipse'));
    expect(current!.shapeKind).toBe('ellipse');
    act(() => current!.toolCreated('x'));
    expect(current!.tool).toBe('select');
  });
});
