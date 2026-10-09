import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STICKY_BUTTON_LABEL } from '../../src/client/board/Toolbar';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { LOAD_FAILED_LABEL } from '../../src/client/sync/ConnectionStatus';
import {
  boardNotes,
  buttonByLabel,
  createNoteViaButton,
  doubleClick,
  dragNote,
  editorElement,
  flushFrames,
  getStickyTextFor,
  notePosition,
  pressKey,
  renderBoard,
  selectNote,
  startEditingNote,
  viewportElement,
  VIEWPORT_FIXTURE,
} from './fixtures/board';
import { socketsCloseWith, socketsLive } from './fixtures/socket';

/**
 * The board as the PRD describes it while its load keeps failing (`persist.client_status`,
 * TC-23): the red line is there, and every road to a board mutation — double-click,
 * the (disabled) Sticky note button, the Delete key, a drag, typing — leads nowhere.
 * "zero board-model mutation calls" is checked the way the model is observable: the
 * document has exactly what it had, byte for byte, after all five are tried.
 */
describe('the board while its load fails (TC-23)', () => {
  it('takes no notes, no deletes, no drags and no text while it says the board could not be loaded', async () => {
    await renderBoard();
    await socketsLive();
    const id = await createNoteViaButton(); // made while the board was still fine
    const untouched = notePosition(id);
    const before = boardNotes();

    // The room starts saying it cannot load this board.
    socketsCloseWith(CLOSE_BOARD_LOAD_FAILED);
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Connection status' })?.textContent,
      ).toBe(LOAD_FAILED_LABEL),
    );

    // 1. The toolbar button is disabled — and clicking it anyway still changes nothing.
    const sticky = buttonByLabel(STICKY_BUTTON_LABEL);
    expect(sticky.disabled).toBe(true);
    act(() => {
      sticky.click();
    });
    await flushFrames();
    expect(boardNotes()).toHaveLength(1);

    // 2. Double-clicking the board creates nothing.
    doubleClick({ x: VIEWPORT_FIXTURE.width / 2, y: VIEWPORT_FIXTURE.height / 2 }, viewportElement());
    await flushFrames();
    expect(boardNotes()).toHaveLength(1);

    // 3. The Delete key on the selected note deletes nothing.
    await selectNote(id);
    pressKey('Delete');
    await flushFrames();
    expect(boardNotes()).toHaveLength(1);

    // 4. Dragging the note moves nothing.
    await dragNote(id, { x: 60, y: 40 });
    expect(notePosition(id)).toEqual(untouched);

    // 5. Double-clicking the note opens no editor, and the text stays what it was.
    await startEditingNote(id);
    expect(editorElement()).toBeNull();
    expect(getStickyTextFor(id)).toBe('');

    // The document, byte for byte, is what it was when the load failed.
    expect(boardNotes()).toEqual(before);
  });
});
