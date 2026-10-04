import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyAddedText,
  applyLocalEdit,
  mapCaret,
  textEdit,
  type TextDeltaOp,
} from '../../src/client/objects/StickyText';

/**
 * What happens to note text when two people are in the same note at the same time (story 3,
 * TC-23): the write a keystroke makes, and the merge of a change that arrives from the other
 * person while this person is typing.
 *
 * Against two real `Y.Doc`s wired the way the room wires people - every update one side makes
 * goes to the other, and never back to whoever sent it - because the thing at issue is whether
 * the other person's letters survive, and that can only be seen in what two documents end up
 * agreeing on.
 */

/** Two documents that share everything either of them writes. */
function wired(): { alex: Y.Doc; sam: Y.Doc; note: Y.Text; other: Y.Text } {
  const alex = new Y.Doc();
  const sam = new Y.Doc();
  alex.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== sam) {
      Y.applyUpdate(sam, update, alex);
    }
  });
  sam.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== alex) {
      Y.applyUpdate(alex, update, sam);
    }
  });
  return { alex, sam, note: alex.getText('note'), other: sam.getText('note') };
}

function letters(value: string): string {
  return [...value].sort().join('');
}

describe('story 3 TC-23: the change a keystroke makes', () => {
  it('TC-23: two people appending to an empty note both keep their letters', () => {
    const { note, other } = wired();

    // Both of them opened the same empty note, and each typed one letter at the end of it.
    applyLocalEdit(note, '', 'a', 'alex');
    applyLocalEdit(other, '', 'b', 'sam');

    // Which one came first is yjs's business; that both are there is the requirement.
    expect(letters(note.toString())).toBe('ab');
    expect(other.toString()).toBe(note.toString());
  });

  it('TC-23b: a keystroke taken from a text that never saw the other person keeps theirs', () => {
    const { note, other } = wired();

    applyLocalEdit(note, '', 'a', 'alex');
    // Sam is still looking at a note that only has his own letter in it - his editor has not
    // been told about Alex's yet - and he types on. Writing his whole value here would say
    // "the note is bc now", which is a deletion of Alex's letter.
    applyLocalEdit(other, '', 'b', 'sam');
    applyLocalEdit(other, 'b', 'bc', 'sam');

    expect(note.toString()).toContain('a');
    expect(letters(note.toString())).toBe('abc');
    expect(other.toString()).toBe(note.toString());
  });

  it('TC-23c: typing at the start of existing text inserts there rather than replacing it', () => {
    const { note } = wired();
    note.insert(0, 'hello');

    applyLocalEdit(note, 'hello', 'Xhello', 'alex');
    expect(note.toString()).toBe('Xhello');

    // One insert and no delete at all, which is what lets the other person's document merge
    // this instead of overwriting what it holds.
    const deltas: { insert?: string; retain?: number; delete?: number }[][] = [];
    const observer = (event: Y.YEvent<Y.Text>): void => {
      deltas.push(event.delta as { insert?: string; retain?: number; delete?: number }[]);
    };
    note.observe(observer);
    applyLocalEdit(note, 'Xhello', 'XYhello', 'alex');
    note.unobserve(observer);

    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.filter((op) => op.delete !== undefined)).toEqual([]);
    expect(deltas[0]!.filter((op) => op.insert !== undefined)).toEqual([{ insert: 'Y' }]);
    expect(note.toString()).toBe('XYhello');
  });

  it('TC-23d: writing the text that is already there emits nothing at all', () => {
    const { note } = wired();
    note.insert(0, 'abc');

    let updates = 0;
    note.doc?.on('update', () => {
      updates += 1;
    });
    applyLocalEdit(note, 'abc', 'abc', 'alex');

    expect(updates).toBe(0);
    expect(note.toString()).toBe('abc');
  });

  it('TC-23e: only what is really there is deleted, whatever the baseline claimed', () => {
    const { note } = wired();
    note.insert(0, 'ab');

    // A baseline that claims more text than the note holds cannot delete past its end.
    applyLocalEdit(note, 'abcdef', 'ab', 'alex');

    expect(note.toString()).toBe('ab');
  });
});

describe('story 3 TC-23: where the caret is after a change from the other person', () => {
  /** The delta yjs reports for one letter added at the very end. */
  const appendedAtEnd: TextDeltaOp[] = [{ retain: 3 }, { insert: 'd' }];

  it('TC-23f: text added in front of the caret pushes it along', () => {
    expect(mapCaret([{ insert: 'a' }, { retain: 1 }], 1)).toBe(2);
  });

  it('TC-23g: text added at the end leaves a caret that is already at the end alone', () => {
    expect(mapCaret(appendedAtEnd, 3)).toBe(3);
  });

  it('TC-23h: text taken out in front of the caret pulls it back', () => {
    // 'hello world' lost 'llo wo' and gained a space; a caret that was after all of it is
    // now after the space instead.
    const delta: TextDeltaOp[] = [{ retain: 2 }, { insert: ' ' }, { delete: 6 }, { retain: 3 }];

    expect(mapCaret(delta, 8)).toBe(3);
    expect(mapCaret(delta, 11)).toBe(6);
  });

  it('TC-23i: a caret inside text that was taken out goes where the replacement went', () => {
    const delta: TextDeltaOp[] = [{ retain: 2 }, { insert: ' ' }, { delete: 6 }, { retain: 3 }];

    expect(mapCaret(delta, 4)).toBe(3);
  });

  it('TC-23j: a caret before the change does not move', () => {
    expect(mapCaret([{ retain: 2 }, { delete: 3 }, { retain: 1 }], 1)).toBe(1);
  });

  it('TC-23k: an empty change leaves the caret where it was', () => {
    expect(mapCaret([], 5)).toBe(5);
    expect(mapCaret([{ retain: 9 }], 5)).toBe(5);
  });
});

describe('story 3 TC-23: a composition that finished on top of a change from the other person', () => {
  it('TC-23l: what the composition added goes in, and so does what arrived', () => {
    const { note, other } = wired();
    note.insert(0, 'neko');

    // Sam added a '!' while Alex was mid-word in Japanese input, and Alex's editor still
    // holds only what Alex has typed.
    applyLocalEdit(other, 'neko', 'neko!', 'sam');
    applyAddedText(note, 'neko', 'nekoneko', 'alex');

    expect(note.toString()).toBe('nekoneko!');
    expect(other.toString()).toBe(note.toString());
  });

  it('TC-23m: a composition that added nothing writes nothing', () => {
    const { note } = wired();
    note.insert(0, 'neko');

    let updates = 0;
    note.doc?.on('update', () => {
      updates += 1;
    });
    applyAddedText(note, 'neko', 'neko', 'alex');

    expect(updates).toBe(0);
  });
});

describe('story 3 TC-23: describing a change', () => {
  it('TC-23l: one insert, one delete, and where they go', () => {
    expect(textEdit('abc', 'aXc')).toEqual({ start: 1, removed: 1, inserted: 'X' });
    expect(textEdit('abc', 'abc')).toEqual({ start: 3, removed: 0, inserted: '' });
    expect(textEdit('', 'ab')).toEqual({ start: 0, removed: 0, inserted: 'ab' });
    expect(textEdit('abc', '')).toEqual({ start: 0, removed: 3, inserted: '' });
  });

  it('TC-23m: an emoji is never split between the two halves of a change', () => {
    const change = textEdit('a\u{1F600}b', 'a\u{1F600}cb');

    expect(change).toEqual({ start: 3, removed: 0, inserted: 'c' });
  });
});
