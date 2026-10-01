import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: Y.Doc, _id: string, onState: (s: string) => void) => {
    onState('load_failed');
    return { destroy() {} };
  },
}));

import { App } from '../../src/client/App';
import { useTool } from '../../src/client/board/useTool';
import { viewport } from './helpers';

afterEach(cleanup);

describe('text.not_editable (TC-15)', () => {
  it('T is ignored, the Text button is disabled and a click creates nothing', () => {
    const doc = new Y.Doc();
    render(<App doc={doc} boardId="abc" />);
    const button = screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(viewport(), { clientX: 300, clientY: 200, button: 0 });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('an active Text tool reverts to Select when editing stops, and does not come back', () => {
    const { result, rerender } = renderHook(({ can }) => useTool(can), { initialProps: { can: true } });
    act(() => result.current.setTool('text'));
    expect(result.current.tool).toBe('text');
    rerender({ can: false });
    expect(result.current.tool).toBe('select');
    act(() => result.current.setTool('text'));
    expect(result.current.tool).toBe('select');
    rerender({ can: true });
    expect(result.current.tool).toBe('select');
  });
});
