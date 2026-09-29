/**
 * Story 9 component test — text.tool_ui (TC-15, negative): on a board that
 * failed to load (read-only), the Text tool is unavailable: the button is
 * disabled and pressing T does nothing.
 *
 * The provider is mocked at file level (like load-failure.test.tsx) so the
 * whole file runs against a `load_failed` board.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { snapshot } from 'src/shared/board-model';

vi.mock('src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: vi.fn((_doc, _boardId, onState) => {
      onState('load_failed');
      return {
        destroy: () => {},
        dropSocket: () => {},
        resumeSocket: () => {},
      };
    }),
  };
});

import { App } from 'src/client/App';
import { boardReady } from './ready';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

describe('text.tool_ui locked board (TC-15)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('on a locked board the Text button is disabled and T does nothing', async () => {
    // The mocked provider reports `load_failed` synchronously in the mount
    // effect; the re-render with the locked state flushes on the next tick.
    await waitFor(() =>
      expect(screen.getByTestId('connection-status')).toHaveTextContent(
        "This board couldn't be loaded",
      ),
    );
    const textButton = screen.getByTestId('text-tool-button');
    expect(textButton).toBeDisabled();
    expect(textButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('select-tool-button')).toHaveAttribute('aria-pressed', 'true');

    const user = userEvent.setup();
    await user.keyboard('T');
    expect(textButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('select-tool-button')).toHaveAttribute('aria-pressed', 'true');

    // Clicking the disabled button does nothing either.
    expect(() => fireEvent.click(textButton)).not.toThrow();
    expect(textButton).toHaveAttribute('aria-pressed', 'false');

    // And no text object can be created by a click in "text" mode — the tool
    // is Select, so a click just clears the (empty) selection.
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 400, clientY: 300 });
    expect(snapshot(getDoc())).toHaveLength(0);
  });
});
