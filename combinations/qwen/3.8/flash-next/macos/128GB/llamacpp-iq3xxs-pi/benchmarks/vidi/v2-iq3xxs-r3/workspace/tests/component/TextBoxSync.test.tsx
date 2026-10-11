/**
 * Story 9: who writes a text object's box (task 5, TC-12, TC-13).
 *
 * `useTextBoxSync` has one rule and it is worth a component test on a real
 * document with a real second person on it: a text's `width`/`height` are
 * written by the client that changed that text, and by nobody else. Every board
 * would measure the same heading a slightly different way — different fonts,
 * different moment — so five clients writing their own measurement would be five
 * clients arguing in the document about dimensions nobody chose.
 *
 * The box is counted, not inspected for its expected value alone: "one write"
 * and "no write" are what the story asks for, and a helper that wrote a box in
 * three passes would fail here even if the last pass were right.
 */

import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN, moveObjects, objectOf } from '../../src/shared/board-model';
import { TEXT_BOX_PADDING_WORLD, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { getTextContent, getTextBox, getTextWidthMode, setTextSize } from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { TextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { fakeMeasurer, seedText, watchBoxWrites } from './helpers/text-board';
import { withPeer } from '../unit/helpers/peer';

/** Mounts the hook and hands the caller its return value. */
function BoxSync({
  doc,
  id,
  into,
}: {
  doc: Y.Doc;
  id: string;
  into: { current: TextBoxSync | null };
}): null {
  into.current = useTextBoxSync(doc, id, fakeMeasurer);
  return null;
}

interface Board {
  readonly local: Y.Doc;
  readonly peer: Y.Doc;
  readonly id: string;
  readonly writes: ReturnType<typeof watchBoxWrites>;
  readonly sync: { current: TextBoxSync | null };
}

/**
 * A board with a heading on it, a second person, and this client measuring:
 * the heading is seeded by the peer, so nothing on this side is owed a box.
 */
function boardWithHeading(text = 'Went well'): Board {
  const { local, peer } = withPeer();
  const id = seedText(peer, { x: 0, y: 0, text });
  const sync = { current: null as TextBoxSync | null };
  render(<BoxSync doc={local} id={id} into={sync} />);
  return { local, peer, id, writes: watchBoxWrites(local, id), sync };
}

/** Type into the text the way the editor does: this client, its own origin. */
function localEdit(doc: Y.Doc, id: string, text: string): void {
  doc.transact(() => {
    getTextContent(doc, id)?.insert(0, text);
  }, LOCAL_ORIGIN);
}

describe('story 9 text box sync (text.height)', () => {
  // TC-12 — the first half: somebody else's change, however differently this
  // client would have measured it, changes nothing here.
  it('TC-12: writes no box when the change came from another client', () => {
    const { local, peer, id, writes } = boardWithHeading();
    const seeded = getTextBox(local, id);
    // The box the peer left behind is not what this client would measure — that
    // is the point: it is still not this client's to correct.
    expect(seeded?.width).toBe(TEXT_MIN_WIDTH_WORLD);

    writes.reset();
    act(() => {
      // The peer keeps typing in the same text, and the change arrives through
      // the room (no `LOCAL_ORIGIN` on this side).
      peer.transact(() => {
        getTextContent(peer, id)?.insert(0, 'Retro ');
      });
    });

    expect(writes.count()).toBe(0);
    expect(getTextBox(local, id)).toEqual(seeded);
    expect(getTextContent(local, id)?.toString()).toBe('Retro Went well');

    // A width somebody else set is theirs as well: it is adopted, not argued with.
    act(() => {
      peer.transact(() => {
        objectOf(peer, id)?.set('width', 400);
      });
    });
    expect(writes.count()).toBe(0);
    expect(getTextBox(local, id)?.width).toBe(400);
  });

  // TC-12 — the second half: a change this client makes is measured once, in one
  // write, and the box is what the layout said.
  it('TC-12: writes the box once when this client changed the text', () => {
    const { local, id, writes } = boardWithHeading();
    writes.reset();

    act(() => {
      localEdit(local, id, '!');
    });

    // 'Went well!' is 10 characters: 100 units at size M under `fakeMeasurer`,
    // plus the room at each edge of the box, and one line tall.
    expect(writes.count()).toBe(1);
    expect(getTextBox(local, id)).toMatchObject({ width: 100 + TEXT_BOX_PADDING_WORLD * 2, height: 26 });
  });

  it('writes the box once when this client picked another size', () => {
    const { local, id, writes } = boardWithHeading();
    act(() => {
      localEdit(local, id, '!');
    });
    writes.reset();

    act(() => {
      setTextSize(local, id, 'XL');
    });

    // Same ten characters at 56 units: 280 wide, and 73 tall.
    expect(writes.count()).toBe(1);
    expect(getTextBox(local, id)).toMatchObject({ width: 280 + TEXT_BOX_PADDING_WORLD * 2, height: Math.round(56 * TEXT_LINE_HEIGHT) });
    expect(getTextBox(local, id)?.height).toBe(Math.round(1 * TEXT_SIZES.XL * TEXT_LINE_HEIGHT));
  });

  // TC-12's third half, and the reason the hook listens to widths as well as
  // text: a drag on an `e`/`w` handle writes a width and nothing else, and the
  // height that falls out of it has to be written by the same client, once.
  it('TC-12: turns a width this client dragged into a fixed width and a new height, in one write', () => {
    const { local, id, writes } = boardWithHeading();
    act(() => {
      localEdit(local, id, '!');
    });
    const before = getTextBox(local, id);
    expect(before?.width).toBe(100 + TEXT_BOX_PADDING_WORLD * 2);
    writes.reset();

    // The handle gesture, which is what writes this: the width, and no more.
    act(() => {
      local.transact(() => {
        objectOf(local, id)?.set('width', TEXT_MIN_WIDTH_WORLD);
      }, LOCAL_ORIGIN);
    });

    // Two writes in total, and only one of them is the hook's: the drag's own
    // width, then a single box write carrying the new height (and the mode) —
    // not a width, then a height, then a mode, which is three undo steps of
    // nobody's intention.
    expect(writes.count()).toBe(2);
    expect(writes.heights()).toBe(1);
    expect(getTextWidthMode(local, id)).toBe('fixed');
    const after = getTextBox(local, id);
    expect(after?.width).toBe(TEXT_MIN_WIDTH_WORLD);
    // 'Went well!' at a 40-unit box: neither word fits on a line with the other,
    // so it is two lines tall where it was one.
    expect(after?.height).toBe(Math.round(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT));
  });

  // TC-13 — the negative that keeps a board quiet: a local change whose box is
  // already right is not a write at all, however often it is asked about.
  it('TC-13: does not write the box again when the measurement did not change', () => {
    const { local, id, writes, sync } = boardWithHeading();
    act(() => {
      localEdit(local, id, '!');
    });
    expect(writes.count()).toBe(1);
    expect(sync.current).not.toBeNull();

    writes.reset();
    // A move: local, its own transaction, and a box that did not move at all.
    act(() => {
      moveObjects(local, new Map([[id, { x: 5, y: 7 }]]));
    });
    expect(writes.count()).toBe(0);

    // And asking for the measurement again, three times over, changes nothing.
    act(() => {
      sync.current?.remeasureAfterLocalChange();
      sync.current?.remeasureAfterLocalChange();
      sync.current?.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(0);

    // Deleting the text while the hook is mounted is not a crash either: there is
    // simply nothing left to measure.
    writes.reset();
    act(() => {
      local.getMap('objects').delete(id);
    });
    expect(writes.count()).toBe(0);
  });
});
