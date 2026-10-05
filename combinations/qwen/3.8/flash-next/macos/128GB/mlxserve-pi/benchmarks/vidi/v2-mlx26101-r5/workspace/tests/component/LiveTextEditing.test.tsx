/**
 * Two people typing in one sticky note, at the same time.
 *
 * This is the part of live collaboration where a careless implementation loses typing: the
 * text box holds what a person has typed, and every keystroke writes that box back into the
 * shared text. If the box has not been told about what arrived in the meantime, the write
 * describes the whole box and quietly removes the other person's characters.
 *
 * So the fixture is two real editors, in two real `Y.Doc`s, with the updates relayed from
 * one to the other the way the room relays them — and the assertions are about characters
 * nobody is allowed to lose.
 */

import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { createSticky, getStickyText, initDoc } from '../../src/shared/board-model';

/** Somebody editing one note, with their own copy of the board and their own text box. */
interface Person {
  readonly name: string;
  readonly doc: Y.Doc;
  readonly box: HTMLTextAreaElement;
  /** Types at the caret, the way a keyboard does. */
  type(text: string): Promise<void>;
  /** What the shared text holds for them right now. */
  shared(): string;

}

/**
 * Two boards holding one note, with every update relayed to the other.
 *
 * The relay passes the arriving document as the update's origin, which is how the editor
 * tells somebody else's change from its own typing.
 */
function twoPeopleTyping(base: string): [Person, Person] {
  const first = new Y.Doc();
  initDoc(first);
  const id = createSticky(first, { x: 0, y: 0 });
  if (typeof id !== 'string') throw new Error('could not make the note');
  const firstText = getStickyText(first, id);
  if (!firstText) throw new Error('note has no text');
  firstText.insert(0, base, 'setup');

  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first), 'setup');

  relay(first, second);
  relay(second, first);

  return [person('Alex', first, id), person('Sam', second, id)];
}

/** Relays every update from one document to the other, once. */
function relay(from: Y.Doc, to: Y.Doc): void {
  from.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === to) return;
    Y.applyUpdate(to, update, from);
  });
}

/** Mounts the real editor over one person's copy of the note's text. */
function person(name: string, doc: Y.Doc, id: string): Person {
  const container = document.createElement('div');
  document.body.append(container);
  const ytext = getStickyText(doc, id);
  if (!ytext) throw new Error('note has no text');
  const onEnd = vi.fn();
  render(<StickyTextEditor fontPx={28} onEnd={onEnd} ytext={ytext} />, { container });
  const box = container.querySelector('textarea');
  if (!box) throw new Error('the editor did not render a text box');

  return {
    name,
    doc,
    box,
    async type(text: string): Promise<void> {
      for (const character of text) {
        const caret = box.selectionStart ?? box.value.length;
        const next = `${box.value.slice(0, caret)}${character}${box.value.slice(box.selectionEnd ?? caret)}`;
        await act(async () => {
          fireEvent.input(box, { target: { value: next } });
          box.setSelectionRange(caret + character.length, caret + character.length);
          await Promise.resolve();
        });
      }
    },
    shared: () => ytext.toString(),
  };
}

describe('two people typing in the same note', () => {
  it('TC-23 keeps both people’s characters when they type at the same time', async () => {
    const [alex, sam] = twoPeopleTyping('notes: ');

    // They type alternately, and each one's keystroke travels before the next lands.
    await alex.type('ab');
    await sam.type('xy');
    await alex.type('c');
    await sam.type('z');

    expect(alex.shared()).toBe(sam.shared());
    // Every character both of them typed is still there, and nothing was invented: the text
    // is exactly what they started with plus the six characters in it. Not in any particular
    // order — two people typing at one spot is not a sequence — but all of it.
    expect(alex.shared().length).toBe('notes: '.length + 6);
    expect([...alex.shared()].filter((c) => 'abcxyz'.includes(c)).sort().join('')).toBe('abcxyz');

    // And each person can see the other's typing in their own box.
    expect(alex.box.value).toBe(alex.shared());
    expect(sam.box.value).toBe(sam.shared());
  });

  it('does not lose the other person’s typing on the keystroke after it arrives', async () => {
    // The regression this exists for: a change arrives, the next local keystroke writes the
    // whole box back, and the other person's characters vanish with it.
    const [alex, sam] = twoPeopleTyping('shared');

    await sam.type('!'); // Travels to Alex, whose box has not been told about it yet.
    expect(alex.box.value).toContain('!');

    await alex.type('?');
    expect(alex.shared()).toContain('!');
    expect(alex.shared()).toContain('?');
    expect(sam.shared()).toContain('!');
    expect(sam.shared()).toContain('?');
  });

  it('shows the other person’s typing in the box as it arrives', async () => {
    const [alex, sam] = twoPeopleTyping('');
    await sam.type('good morning');
    expect(alex.box.value).toBe('good morning');
    expect(alex.shared()).toBe('good morning');
  });

  it('keeps my typing when the other person deletes text I am not touching', async () => {
    const [alex, sam] = twoPeopleTyping('first line\nsecond line\n');

    await sam.type(' and more'); // Sam's caret is at the end.
    await alex.type('x'); // So is Alex's, after their own text.

    expect(alex.shared()).toContain('x');
    expect(alex.shared()).toContain(' and more');
    expect(sam.shared()).toBe(alex.shared());
  });

  it('merges what arrived during an input method composition when it finishes', async () => {
    const [alex, sam] = twoPeopleTyping('day: ');

    // Alex is in the middle of an input method composition; Sam's typing arrives. The box is
    // left alone until the composition ends, and then both texts are in the shared note.
    await act(async () => {
      fireEvent.compositionStart(alex.box);
      fireEvent.input(alex.box, { target: { value: `${alex.box.value}\u304d` } });
      await Promise.resolve();
    });
    await sam.type('!');
    await act(async () => {
      fireEvent.input(alex.box, { target: { value: `${alex.box.value}\u306d` } });
      fireEvent.compositionEnd(alex.box, { data: '\u304d\u306d' });
      await Promise.resolve();
    });

    expect(alex.shared()).toContain('\u304d\u306d');
    expect(alex.shared()).toContain('!');
    expect(sam.shared()).toBe(alex.shared());
  });
});
