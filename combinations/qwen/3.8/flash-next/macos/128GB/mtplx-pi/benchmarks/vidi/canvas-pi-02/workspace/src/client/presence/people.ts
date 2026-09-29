import { PRESENCE_COLORS } from '../../shared/config';
import { GUEST_NAMES, NAME_FALLBACK } from './identity';
import { inPalette } from './colors';
/**
 * What the board knows about one other person, and how long it is trusted.
 *
 * Kept in its own file because both the cursors and the stack read it, and
 * because the two rules that decide whether a person is *drawn* at all belong
 * with the data rather than in each component.
 */

/** How long a cursor keeps being drawn after the last update about it. */
export const CURSOR_VISIBLE_AFTER_MS = 2_000;

/** The most of a name either of the two surfaces ever shows. */
export const NAME_LABEL_MAX_CHARS = 40;

/** A person as the board sees them, in world coordinates. */
export interface Person {
  clientId: number;
  name: string;
  color: string;
  /**
   * Whose browser this is, shared by every tab of it.
   *
   * The client id is per *tab*, so a person with the board open twice would
   * otherwise be counted twice — two avatars and two arrows for one person.
   * Empty when a state arrives without one, which is what a foreign or older
   * client looks like; those are never merged with anybody.
   */
  id: string;
  /** World coordinates of their pointer, or `null` when they are on the board but not pointing. */
  x: number | null;
  y: number | null;
  /**
   * The note ids they have picked up, newest word from their side.
   *
   * Ids rather than rectangles, because a note may have moved or gone while the
   * news was in flight, and the only honest outline is one drawn against what
   * is actually on this board right now.
   */
  selection: readonly string[];
  /** When the last update about them arrived, as `Date.now()`-style milliseconds. */
  lastActive: number;
  /**
   * When *they* sent it, on their clock.
   *
   * Two tabs of one person disagree about time by however long ago each was
   * loaded, so this is only ever compared between states that share an `id`,
   * and only to answer "which of these two arrows is the newer one".
   */
  sentAt: number;
}

/** Whether this person's cursor should be on the screen right now. */
export function cursorVisible(person: Person, now: number): boolean {
  if (person.x === null || person.y === null) return false;
  return now - person.lastActive <= CURSOR_VISIBLE_AFTER_MS;
}

/**
 * A name shortened for one of the two surfaces.
 *
 * Forty characters is the number the design gives, and it is applied to both
 * the floating label and the stack tooltip. Shortening is a *cut* rather than
 * an ellipsis-with-room: a label that grows back to its full length when a
 * name is long is a label that moves, and a moving label is harder to read
 * than a short one.
 */
export function nameLabel(name: string): string {
  return name.length <= NAME_LABEL_MAX_CHARS ? name : name.slice(0, NAME_LABEL_MAX_CHARS);
}

/**
 * One person, maybe from several tabs.
 *
 * The stack shows *people*, not sockets: two windows of the same browser are
 * one person, and the arrow that follows is the one that moved most recently.
 * A person whose tabs disagree about the time (they were loaded minutes apart)
 * still gets exactly one dot, because the comparison that matters is between
 * their own tabs, not between clocks. States with no `id` are never merged:
 * somebody we cannot identify is somebody we cannot prove is already here.
 */
export function dedupePeople(people: readonly Person[]): readonly Person[] {
  const newest = new Map<string, Person>();
  const anonymous: Person[] = [];
  for (const person of people) {
    if (person.id === '') {
      anonymous.push(person);
      continue;
    }
    const already = newest.get(person.id);
    // Same person, newer arrow: the newer tab wins, and it keeps the *slot* of
    // the one it replaces so the arrow does not jump when a second window is
    // opened. A tie in time goes to the lower client id, which is the same
    // tie-breaker every other rule here uses.
    if (already === undefined || person.sentAt > already.sentAt) {
      newest.set(person.id, person);
    }
  }
  const merged = [...newest.values()];
  if (merged.length + anonymous.length === people.length) {
    return [...people].sort((a, b) => a.clientId - b.clientId);
  }
  return [...merged, ...anonymous].sort((a, b) => a.clientId - b.clientId);
}

/**
 * Making a set of people tell each other apart (story 6, TC-06, TC-12, TC-13).
 *
 * Everyone arrives wearing a name and a colour chosen on their own machine,
 * because there is nothing on a board that hands those out. Five people opening
 * a shared link therefore arrive wearing the same first name and the same first
 * colour, and the board has to *show* five people anyway — that is the whole
 * story. This function is how.
 *
 * ## Why it is a pass over the whole board rather than a rule per browser
 *
 * The first version asked each browser to notice a clash and change its own
 * published state. It does not work, and the reason is worth keeping: five
 * blinds all pick red, all then see red taken, and all move to green — together,
 * and again for the next colour, for as long as anybody moves a mouse. A rule
 * that depends on what each person *last published* has nothing to break the
 * tie, because five people publish the same thing at the same moment.
 *
 * A single pass, taken in client-id order, does have a tie-breaker. Each person
 * is offered the first name and the first colour that nobody *earlier in the
 * order* has been given, and each board runs the same pass over the same set. So
 * every screen draws the same five people in the same five colours, nobody has
 * to announce a correction, nothing re-publishes when a clash appears, and the
 * answer cannot oscillate because it is a function of a set rather than a race.
 *
 * The order is the client id rather than the arrival time for the same reason
 * the cursor keys are: a board and a laptop that disagree about who came first
 * disagree about who keeps the name, which is the flicker this replaces.
 *
 * ## What happens when the palette or the name pool runs out
 *
 * Colours repeat, from a rotation that starts at each person's own id rather
 * than at the top of the palette, so a crowd of ten is spread over the eight
 * colours instead of stacked on one. Names get a number (`River 2`), which is
 * what the design asks for when the pool is exhausted: a numbered name still
 * says who, and a repeated colour plus a different name is still distinguishable.
 */
export function distinguish(people: readonly Person[]): readonly Person[] {
  const ordered = [...people].sort((a, b) => a.clientId - b.clientId);
  const named = new Set<string>();
  const worn = new Set<string>();
  return ordered.map((person) => {
    const name = uniqueName(person.name, named);
    const color = uniqueColor(person.clientId, person.color, worn);
    named.add(name);
    worn.add(color);
    if (name === person.name && color === person.color) return person;
    // A copy, so the snapshot the transport keeps stays the thing that arrived.
    return { ...person, name, color };
  });
}

/** The first name this person can be called, given who has been called already. */
function uniqueName(preferred: string, taken: ReadonlySet<string>): string {
  if (!taken.has(preferred)) return preferred;
  // Their own name with a number first: somebody who arrived as `River` and
  // found it taken should still look like the River they came as, not like a
  // different word from the pool.
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${preferred} ${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (const name of [...GUEST_NAMES, NAME_FALLBACK]) {
    if (!taken.has(name)) return name;
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const candidate = `${name} ${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  // More people than names. Keep the preferred one: at this point a name that
  // repeats is a worse problem than a name that says nothing.
  return preferred;
}

/** The colour this person is drawn in, given who has been drawn already. */
function uniqueColor(ownClientId: number, preferred: string, taken: ReadonlySet<string>): string {
  // A colour outside the palette — the neutral slate a tenth person gets — is
  // nobody's colour, so there is nothing to give way to.
  if (!inPalette(preferred)) return preferred;
  if (!taken.has(preferred)) return preferred;
  // Starting at an offset derived from the id is what stops two people fleeing
  // the same colour from landing on the same free one.
  const start = ((ownClientId % PRESENCE_COLORS.length) + PRESENCE_COLORS.length) % PRESENCE_COLORS.length;
  for (let offset = 0; offset < PRESENCE_COLORS.length; offset += 1) {
    const index = (start + offset) % PRESENCE_COLORS.length;
    const color = PRESENCE_COLORS[index];
    if (color !== undefined && !taken.has(color)) return color;
  }
  return preferred;
}

