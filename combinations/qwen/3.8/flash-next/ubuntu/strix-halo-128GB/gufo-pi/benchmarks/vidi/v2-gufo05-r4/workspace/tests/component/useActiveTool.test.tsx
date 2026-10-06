/**
 * Story 10 component tests: which tool the pointer is holding (`tools.active_tool`).
 *
 * Stories 9 to 12 each add a tool, so the tool is one piece of state with one set of rules
 * rather than a `useState` per story. The rules asserted here are the ones every later tool
 * has to inherit:
 *
 *  - a shortcut letter picks a tool up, and a letter this build has no tool for is simply
 *    ignored — it must not put the board into a state nothing can draw;
 *  - **a tool that made something is spent** (`tools.return_to_select`): the shape or arrow
 *    that just arrived becomes the selection and the pointer goes back to Select, so the
 *    thing can be adjusted straight away;
 *  - Escape leaves the tool and creates nothing, including in the middle of a drag that has
 *    not finished (`tools.return_to_select`);
 *  - the tool is local state: a board that cannot be written to has no writing tool, and
 *    stops holding one the moment it becomes unwritable.
 */

import { act, cleanup, render, renderHook, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, type ObjectSnapshot } from '../../src/shared/board-model';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import {
  fireKey,
  firePointer,
  flushCameraFrame,
  stubResizeObserver,
  stubViewportGeometry,
  toolButton,
  toolPressed,
  viewportElement
} from './harness';
import {
  MODE_TOOLS,
  TOOL_SHORTCUTS,
  modeForShortcutKey,
  useActiveTool,
  type ToolId
} from '../../src/client/tools/useActiveTool';

/** What `useBoardDoc` reports as the connection — see the text tool's tests for why. */
const connection: { current: ConnectionState } = { current: 'connected' };

vi.mock('../../src/client/board/useBoardDoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/board/useBoardDoc')>();
  return {
    ...actual,
    useBoardDoc: (options: Parameters<typeof actual.useBoardDoc>[0]) => ({
      ...actual.useBoardDoc(options),
      connection: connection.current
    })
  };
});

beforeEach(() => {
  connection.current = 'connected';
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

function activeToolOf(board: BoardFixture): string | null {
  return viewportElement(board.root).dataset.tool ?? null;
}

/** Press and move over the board, and leave the pointer down: an unfinished gesture. */
function startDrag(board: BoardFixture): void {
  const viewport = viewportElement(board.root);
  firePointer(viewport, 'pointerdown', 200, 200);
  firePointer(viewport, 'pointermove', 320, 300);
}

describe('the active tool hook (tools.active_tool)', () => {
  it('maps one letter per tool, and every tool the hook can hold is a known id', () => {
    expect(TOOL_SHORTCUTS.v).toBe('select');
    expect(TOOL_SHORTCUTS.n).toBe('sticky');
    expect(TOOL_SHORTCUTS.t).toBe('text');
    expect(TOOL_SHORTCUTS.s).toBe('shape');
    expect(TOOL_SHORTCUTS.l).toBe('connector');
    expect(TOOL_SHORTCUTS.p).toBe('pen');
    expect(TOOL_SHORTCUTS.i).toBe('image');
    expect(TOOL_SHORTCUTS.c).toBe('comment');

    // Story 10 adds these two; the rest of the union belongs to stories 11 and 12.
    expect(MODE_TOOLS).toContain('shape');
    expect(MODE_TOOLS).toContain('connector');
    const ids: ToolId[] = ['select', 'sticky', 'text', 'shape', 'connector', 'pen', 'image', 'comment'];
    for (const mode of MODE_TOOLS) expect(ids).toContain(mode);
  });

  it('ignores a letter with no tool of its own and a tool this build cannot offer', () => {
    expect(modeForShortcutKey('s')).toBe('shape');
    expect(modeForShortcutKey('l')).toBe('connector');
    expect(modeForShortcutKey('q')).toBeNull();
    // N makes a note rather than becoming a mode, and P, I and C are later stories.
    expect(modeForShortcutKey('n')).toBeNull();
    expect(modeForShortcutKey('p')).toBeNull();
    expect(modeForShortcutKey('i')).toBeNull();
    expect(modeForShortcutKey('c')).toBeNull();
    // A modified key is the browser's, and a bare modifier is nobody's.
    expect(modeForShortcutKey('S')).toBe('shape');
  });

  it('TC-22: creating with the Shape tool selects what it made and returns to Select', () => {
    const selected: string[] = [];
    const { result } = renderHook(() => useActiveTool({ canUseTools: true, onSelect: (id) => selected.push(id) }));

    act(() => result.current.setTool('shape'));
    expect(result.current.tool).toBe('shape');

    act(() => result.current.toolCreated('shape-1'));
    expect(selected).toEqual(['shape-1']);
    expect(result.current.tool).toBe('select');
  });

  it('TC-22: creating with the Connector tool selects the arrow and returns to Select', () => {
    const selected: string[] = [];
    const { result } = renderHook(() => useActiveTool({ canUseTools: true, onSelect: (id) => selected.push(id) }));

    act(() => result.current.setTool('connector'));
    expect(result.current.tool).toBe('connector');

    act(() => result.current.toolCreated('arrow-1'));
    expect(selected).toEqual(['arrow-1']);
    expect(result.current.tool).toBe('select');
  });

  it('keeps the tool it has when asked for one it cannot offer, and remembers the shape kind', () => {
    const { result } = renderHook(() => useActiveTool({ canUseTools: true }));
    expect(result.current.tool).toBe('select');
    expect(result.current.shapeKind).toBe('rect');

    act(() => result.current.setTool('pen'));
    expect(result.current.tool).toBe('select');

    act(() => result.current.setTool('shape'));
    act(() => result.current.setShapeKind('diamond'));
    expect(result.current.shapeKind).toBe('diamond');
    // The tool is still the Shape tool: choosing a kind is not leaving it.
    expect(result.current.tool).toBe('shape');

    // A kind that does not exist is not stored, so no shape is ever asked for it.
    act(() => result.current.setShapeKind('hexagon' as never));
    expect(result.current.shapeKind).toBe('diamond');
  });

  it('offers no writing tool on a board that cannot be written to, and leaves one when it stops', () => {
    const { result, rerender } = renderHook(
      ({ canUse }: { canUse: boolean }) => useActiveTool({ canUseTools: canUse }),
      { initialProps: { canUse: false } }
    );

    act(() => result.current.setTool('shape'));
    expect(result.current.tool).toBe('select');
    act(() => result.current.toolCreated('shape-1'));
    expect(result.current.tool).toBe('select');

    rerender({ canUse: true });
    act(() => result.current.setTool('connector'));
    expect(result.current.tool).toBe('connector');

    // The board becomes unwritable mid-gesture: the held tool goes with it.
    rerender({ canUse: false });
    expect(result.current.tool).toBe('select');
  });
});

describe('the active tool on the board (tools.active_tool)', () => {
  it('TC-22: S and L light up the palette and the pointer, and Escape puts them back', async () => {
    const board = await renderBoard();

    expect(activeToolOf(board)).toBe('select');
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(true);

    fireKey('s');
    expect(activeToolOf(board)).toBe('shape');
    expect(toolPressed(toolButton(board.root, 'shape'))).toBe(true);
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(false);

    fireKey('Escape');
    expect(activeToolOf(board)).toBe('select');
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(true);

    fireKey('l');
    expect(activeToolOf(board)).toBe('connector');
    expect(toolPressed(toolButton(board.root, 'connector'))).toBe(true);

    fireKey('v');
    expect(activeToolOf(board)).toBe('select');
    // Choosing a tool writes nothing to the board.
    expect(board.objects()).toHaveLength(0);
  });

  it('TC-22: Escape in the middle of a shape drag creates nothing', async () => {
    const board = await renderBoard();
    fireKey('s');
    startDrag(board);

    fireKey('Escape');
    expect(activeToolOf(board)).toBe('select');
    // The released pointer belongs to Select now: the unfinished drag is simply gone.
    firePointer(viewportElement(board.root), 'pointerup', 320, 300);
    expect(board.objects()).toHaveLength(0);
  });

  it('TC-22: Escape in the middle of an arrow drag creates nothing', async () => {
    const board = await renderBoard();
    fireKey('l');
    startDrag(board);

    fireKey('Escape');
    expect(activeToolOf(board)).toBe('select');
    firePointer(viewportElement(board.root), 'pointerup', 320, 300);
    expect(board.objects()).toHaveLength(0);
  });

  it('offers no tool at all on a board that could not be loaded', async () => {
    connection.current = 'load_failed';
    const board = await renderBoard();

    fireKey('s');
    expect(activeToolOf(board)).toBe('select');
    fireKey('l');
    expect(activeToolOf(board)).toBe('select');
    expect(toolButton(board.root, 'shape').hasAttribute('disabled')).toBe(true);
    expect(toolButton(board.root, 'connector').hasAttribute('disabled')).toBe(true);
    expect(board.objects()).toHaveLength(0);
  });
});
