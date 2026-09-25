import { describe, expect, it } from 'vitest';

import { PRESENCE_COLORS } from '../../src/shared/config';
import { distinguish, type Person } from '../../src/client/presence/people';

/**
 * A name or a colour that two people answer to is a bug in the board, not a
 * cosmetic problem: "who moved that note" stops having an answer. So the rule
 * that keeps people apart is tested where it is written — on the whole list of
 * people on the board, which is what `distinguish` is given — rather than
 * through a browser that has to wait for five tabs to agree.
 */

const PALETTE = [...PRESENCE_COLORS];

function person(id: number, name: string, color: string): Person {
  return {
    clientId: id,
    name,
    color,
    id: `p${id}`,
    x: null,
    y: null,
    selection: [],
    lastActive: 1_000,
    sentAt: 0,
  };
}

const NAMES = ['Ada', 'Grace', 'Alan', 'Barbara', 'Edsger', 'Donald', 'Frances', 'Kathleen'];

describe('keeping the people on a board apart', () => {
  it('leaves a board where nobody collides exactly as it arrived', () => {
    const people = [person(1, 'Ada', PALETTE[0]!), person(2, 'Grace', PALETTE[1]!)];
    expect(distinguish(people)).toEqual(people);
  });

  it('gives the second Ada a name of her own', () => {
    const board = distinguish([person(1, 'Ada', PALETTE[0]!), person(2, 'Ada', PALETTE[0]!)]);
    expect(board[0]?.name).toBe('Ada');
    expect(board[1]?.name).not.toBe('Ada');
    expect(board[1]?.name).toContain('Ada');
  });

  it('keeps a room that opened all at once on different colours', () => {
    // The case the browser test cannot fake: five tabs arrive inside the same
    // few milliseconds, each still wearing the first colour, none of them having
    // seen another.
    const people = Array.from({ length: 5 }, (_, index) => person(index + 1, NAMES[index]!, PALETTE[0]!));
    const board = distinguish(people);
    expect(new Set(board.map((entry) => entry.color)).size).toBe(5);
    for (const entry of board) expect(PALETTE).toContain(entry.color);
  });

  it('gives every person up to the size of the palette a colour of their own', () => {
    const people = Array.from({ length: PALETTE.length }, (_, index) =>
      person(index + 1, `Person${String(index)}`, PALETTE[0]!),
    );
    const board = distinguish(people);
    expect(new Set(board.map((entry) => entry.color)).size).toBe(PALETTE.length);
    // …and the first person keeps the colour they walked in with: a rule that
    // moved everybody whenever anybody arrived could never be still.
    expect(board[0]?.color).toBe(PALETTE[0]);
  });

  it('gives every person a name of their own, however many there are', () => {
    // Past the pool the answer is a number rather than a repeat, because a
    // numbered name still says who and a repeated one does not.
    const people = Array.from({ length: 14 }, (_, index) => person(index + 1, 'Ada', PALETTE[0]!));
    const board = distinguish(people);
    expect(new Set(board.map((entry) => entry.name)).size).toBe(14);
  });

  it('spreads a crowd bigger than the palette over the whole palette', () => {
    // Nine people, eight colours: perfect separation is not on offer, and the
    // failure mode is not a repeat, it is nine people in *one* colour.
    const people = Array.from({ length: 9 }, (_, index) => person(index + 1, 'Ada', PALETTE[0]!));
    const board = distinguish(people);
    const colours = new Map<string, number>();
    for (const entry of board) colours.set(entry.color, (colours.get(entry.color) ?? 0) + 1);
    expect(colours.size).toBe(PALETTE.length);
    expect(Math.max(...colours.values())).toBe(2);
  });

  it('answers the same whatever order the people arrive in', () => {
    // Convergence cannot rest on arrival order: two boards that disagree about
    // who came first disagree about who keeps their name, which is the flicker
    // this replaced. Client id is the order, and it is the same order everywhere.
    const people = [person(7, 'Ada', PALETTE[0]!), person(3, 'Ada', PALETTE[0]!), person(9, 'Grace', PALETTE[0]!)];
    expect(distinguish(people)).toEqual(distinguish([...people].reverse()));
  });

  it('leaves people who were already different exactly as they were', () => {
    const people = [
      person(1, 'Ada', PALETTE[0]!),
      person(2, 'Ada', PALETTE[3]!),
      person(3, 'Ada', PALETTE[4]!),
    ];
    const board = distinguish(people);
    expect(board.map((entry) => entry.color)).toEqual([PALETTE[0], PALETTE[3], PALETTE[4]]);
  });

  it('keeps an anonymous person anonymous rather than inventing a name', () => {
    const board = distinguish([person(1, '', PALETTE[0]!), person(2, '', PALETTE[0]!)]);
    expect(board[0]?.name).toBe('');
    // Names are a person's choice; colours are only ever a way of telling people
    // apart, so this is where the rule is allowed to do something.
    expect(board[1]?.color).not.toBe(board[0]?.color);
    expect(PALETTE).toContain(board[1]?.color);
  });

  it('leaves a colour from outside the palette alone', () => {
    // The neutral slate somebody gets when the palette ran out elsewhere is not
    // anybody's colour, so there is nothing here to give way to.
    const board = distinguish([person(1, 'Ada', '#607D8B'), person(2, 'Ada', '#607D8B')]);
    expect(board[0]?.color).toBe('#607D8B');
    expect(board[1]?.color).toBe('#607D8B');
  });

  it('does not disturb where people are pointing', () => {
    const people: Person[] = [
      { ...person(1, 'Ada', PALETTE[0]!), x: 10, y: 20 },
      { ...person(2, 'Ada', PALETTE[0]!), x: null, y: null },
    ];
    const board = distinguish(people);
    expect(board[0]).toEqual(people[0]);
    expect(board[1]).toMatchObject({ x: null, y: null, lastActive: 1_000 });
  });

  it('does not touch the list it was given', () => {
    // The transport keeps this array; a pass that rewrote it in place would
    // quietly rename people on the way past.
    const people = [person(1, 'Ada', PALETTE[0]!), person(2, 'Ada', PALETTE[0]!)];
    const before = structuredClone(people);
    distinguish(people);
    expect(people).toEqual(before);
  });
});
