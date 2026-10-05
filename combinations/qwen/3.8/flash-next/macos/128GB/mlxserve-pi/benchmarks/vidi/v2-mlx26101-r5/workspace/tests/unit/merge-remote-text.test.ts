import { describe, expect, it } from 'vitest';

import { mergeRemoteText } from '../../src/client/objects/StickyText';

/**
 * The arithmetic of two people typing in one note: a change that arrived from somebody
 * else, spliced into a box somebody is typing in.
 *
 * Everything here is about not losing characters: the other person's, because a change that
 * is not merged in is simply gone from the box; and my own, because the box is what gets
 * written back into the shared text on the next keystroke.
 */

describe('merging somebody else’s typing into the box', () => {
  it('says nothing happened when the shared text has not changed', () => {
    const merged = mergeRemoteText('hello', 'hello', 'hello from me', 13);
    expect(merged).toEqual({ text: 'hello from me', caret: 13, changed: false });
  });

  it('keeps my typing and adds theirs when we both typed at the end', () => {
    // Both started from 'hello'. They typed '!', I typed ' there' and my caret is at the end.
    const merged = mergeRemoteText('hello', 'hello!', 'hello there', 11);
    expect(merged.changed).toBe(true);
    expect(merged.text).toContain('there');
    expect(merged.text).toContain('!');
    expect(merged.text).toBe('hello! there');
    // The caret sits at the end of my text, not in the middle of it.
    expect(merged.caret).toBe(merged.text.length);
  });

  it('adds their typing at the end without moving my caret in the middle', () => {
    // Base 'hello world'; they added '!!' at the end; I have the caret between two words.
    const merged = mergeRemoteText('hello world', 'hello world!!', 'hello world', 5);
    expect(merged.text).toBe('hello world!!');
    expect(merged.caret).toBe(5);
  });

  it('keeps my typing in the middle when they add to the end', () => {
    const merged = mergeRemoteText('buy milk', 'buy milk today', 'buy some milk', 13);
    expect(merged.text).toBe('buy some milk today');
    // My caret was at the end of my text, so it stays at the end of the longer text.
    expect(merged.caret).toBe(merged.text.length);
  });

  it('does not move a caret that is ahead of their typing', () => {
    // My caret is at 4, in front of where they added ' today'.
    const merged = mergeRemoteText('buy milk', 'buy milk today', 'buy some milk', 4);
    expect(merged.text).toBe('buy some milk today');
    expect(merged.caret).toBe(4);
  });

  it('removes what they deleted and leaves my typing alone', () => {
    // They deleted ' now' at the end; I had typed 'please ' at the beginning.
    const merged = mergeRemoteText('buy milk now', 'buy milk', 'please buy milk now', 7);
    expect(merged.text).toBe('please buy milk');
    expect(merged.caret).toBe(7);
  });

  it('applies their change ahead of my caret without moving the caret', () => {
    // They fixed the beginning; I am typing at the end.
    const merged = mergeRemoteText('teh note', 'the note', 'teh note is mine', 14);
    expect(merged.text).toBe('the note is mine');
    expect(merged.caret).toBe(14);
  });

  it('takes their version of the whole text when I have typed nothing', () => {
    const merged = mergeRemoteText('old', 'entirely new', 'old', 3);
    expect(merged.text).toBe('entirely new');
    expect(merged.caret).toBe('entirely new'.length);
  });

  it('keeps both versions when we both changed the same stretch', () => {
    // We both replaced the same letter: both letters are kept, even next to each other.
    const merged = mergeRemoteText('abc', 'aXc', 'aYc', 3);
    expect(merged.text).toContain('X');
    expect(merged.text).toContain('Y');
    expect(merged.text).toBe('aXYc');
  });

  it('keeps my characters when we both deleted from the same place', () => {
    // I deleted a letter, they rewrote the end. Nothing I still hold disappears.
    const merged = mergeRemoteText('hello world', 'he?', 'helo world', 10);
    expect(merged.text).toContain('world');
    expect(merged.text).toContain('he');
  });

  it('does not cut an emoji in half when their change lands next to it', () => {
    const base = 'ship it 😀 now';
    const theirs = 'ship it 😀😀 now';
    const mine = 'ship it 😀 now, please';
    const merged = mergeRemoteText(base, theirs, mine, mine.length);
    expect(merged.text).toBe('ship it 😀😀 now, please');
    // No lone halves of a surrogate pair anywhere in the text.
    expect(merged.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(merged.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('puts the caret at the end of the text when a change arrives behind it', () => {
    // Their deletion took the text my caret was sitting in; the caret goes to the end, not past it.
    const merged = mergeRemoteText('abc', '', 'abc', 3);
    expect(merged.text).toBe('');
    expect(merged.caret).toBe(0);
  });

  it('carries a caret at the very start along with the text they added there', () => {
    // Their characters went in at the caret; the caret moves past them so what I type next
    // still goes where I was looking at it.
    const merged = mergeRemoteText('abc', 'xabc', 'abc', 0);
    expect(merged.text).toBe('xabc');
    expect(merged.caret).toBe(1);
  });

  it('handles a note that was empty and is not any more', () => {
    const merged = mergeRemoteText('', 'their first words', '', 0);
    expect(merged.text).toBe('their first words');
    expect(merged.caret).toBe('their first words'.length);
  });

  it('handles a note emptied under somebody who is typing', () => {
    // They deleted everything; my own typing is mine to keep.
    const merged = mergeRemoteText('some text', '', 'some text and more', 18);
    expect(merged.text).toContain('and more');
  });
});
