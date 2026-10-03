/**
 * The numbers and the words the product promises, pinned where they are written
 * (`undo.limit`, `undo.typing`, `undo.buttons`).
 *
 * `undo.steps` says a typing burst ends after "the pause in UNDO_CAPTURE_TIMEOUT_MS", and
 * `undo.limit` says how many steps are kept. Both are published numbers now, so a change
 * to either is a decision somebody has to make on purpose rather than a side effect of
 * tidying up: this file is where that decision has to be re-made.
 *
 * The button labels are pinned here for the same reason. They are asserted twice on
 * purpose: once against the constant the component renders (here), and once against the
 * rendered button itself (`tests/component/UndoControls.test.tsx`), so that neither the
 * wording nor the wiring can quietly drift.
 *
 * TC-28 covers the four values story 8 names.
 */
import { describe, expect, it } from 'vitest';

import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../src/shared/config';
import { REDO_BUTTON_TOOLTIP, UNDO_BUTTON_TOOLTIP } from '../../src/client/board/UndoButtons';

describe('story 8 constants', () => {
  it('TC-28 keeps the capture window at 500 ms and the history at 200 steps', () => {
    // A pause this long ends a burst of typing: shorter, and the history stops feeling
    // like keystrokes; longer, and it stops feeling like thoughts.
    expect(UNDO_CAPTURE_TIMEOUT_MS).toBe(500);
    // Steps kept in memory for one person, oldest dropped first. Memory is the point:
    // nothing of this is ever written to durable storage (`undo.session_only`).
    expect(UNDO_MAX_STEPS).toBe(200);
  });

  it('TC-28 keeps the wording of the two tooltips', () => {
    // The tooltip is the only place the keyboard combinations are written down.
    expect(UNDO_BUTTON_TOOLTIP).toBe('Undo (Ctrl/Cmd+Z)');
    expect(REDO_BUTTON_TOOLTIP).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });
});
