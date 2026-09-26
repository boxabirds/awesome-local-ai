import { CONFLICT_RECENT_EDIT_WINDOW_MS } from '@todoodle/shared/limits';
import type { LiveEvent } from '@todoodle/shared/events';
import { GoneError } from '@/lib/errors';
import { clientId as thisClientId } from './clientId';

/** The values an editor watches: field name -> text (or null). */
export type GuardFields = Record<string, string | null>;

export type Conflict<F extends GuardFields> = {
  /** The user's own values of the fields the other person changed (never discarded without a choice). */
  mine: Partial<F>;
  /** The other person's current values of those fields. */
  theirs: Partial<F>;
  /** True while the edit UI is open (inline notice); false after it closed (persistent toast). */
  editorOpen: boolean;
};

export type GuardState<F extends GuardFields> =
  | { kind: 'idle' }
  | { kind: 'editing' }
  | { kind: 'recentlySaved'; saved: F; savedAt: number }
  | ({ kind: 'conflicted' } & Conflict<F>);

export type EditGuardOptions<F extends GuardFields> = {
  /** 'workspace:<id>' | 'task:<id>' | 'project:<id>' */
  key: string;
  /** The current draft (while editing). */
  getFields(): F;
  /** The consumer's normal save. */
  save(patch: Partial<F>): Promise<void>;
  /** The entity was deleted under the user: close the editor and tell them. */
  onGone(): void;
  now?: () => number;
  clientId?: string;
};

/** The guard key an event is about ('task:<id>'), or null for events that are about many entities. */
export function guardKeyFor(event: LiveEvent): string | null {
  if (event.type === 'tasks.bulk') return null;
  const kind = event.type.slice(0, event.type.indexOf('.'));
  return `${kind}:${event.entity.id}`;
}

function isDeletion(event: LiveEvent): boolean {
  return event.type.endsWith('.deleted');
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

/**
 * One editor's guard against concurrent edits (live.conflict_notice). Server policy is last write wins;
 * this makes sure the person whose edit was replaced is told and chooses whose version to keep.
 * States: idle, editing, recentlySaved (within CONFLICT_RECENT_EDIT_WINDOW_MS of our save), conflicted.
 * Only other people's events for this key matter; own echoes are ignored.
 */
export class EditGuard<F extends GuardFields> {
  readonly key: string;
  private state: GuardState<F> = { kind: 'idle' };
  private readonly listeners = new Set<() => void>();
  private readonly options: EditGuardOptions<F>;
  private readonly now: () => number;
  private readonly clientId: string;

  constructor(options: EditGuardOptions<F>) {
    this.key = options.key;
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.clientId = options.clientId ?? thisClientId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): GuardState<F> => this.state;

  private set(next: GuardState<F>): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** The edit UI opened. A pending conflict is kept (and becomes inline). */
  arm = (): void => {
    if (this.state.kind === 'conflicted') {
      if (!this.state.editorOpen) this.set({ ...this.state, editorOpen: true });
      return;
    }
    if (this.state.kind !== 'editing') this.set({ kind: 'editing' });
  };

  /** The edit UI closed. Closing with a conflict pending counts as Keep theirs. */
  disarm = (): void => {
    if (this.state.kind === 'editing' || this.state.kind === 'conflicted') this.set({ kind: 'idle' });
  };

  /** Our own save succeeded: others' changes in the next CONFLICT_RECENT_EDIT_WINDOW_MS still conflict. */
  markSaved = (saved: F): void => {
    this.set({ kind: 'recentlySaved', saved, savedAt: this.now() });
  };

  /** A live event some handler applied (called from dispatchEvent through the registry). */
  notify(event: LiveEvent): void {
    if (event.originClientId === this.clientId) return;
    const state = this.state;
    if (state.kind === 'idle') return;
    if (state.kind === 'recentlySaved' && this.now() - state.savedAt >= CONFLICT_RECENT_EDIT_WINDOW_MS) {
      this.set({ kind: 'idle' });
      return;
    }
    if (isDeletion(event)) {
      this.gone();
      return;
    }
    const entity = event.entity as Record<string, unknown>;
    if (state.kind === 'conflicted') {
      const theirs: Partial<F> = { ...state.theirs };
      let changed = false;
      for (const field of Object.keys(state.mine) as (keyof F)[]) {
        if (!(field in entity)) continue;
        const value = asText(entity[field as string]) as F[keyof F];
        if (theirs[field] !== value) {
          theirs[field] = value;
          changed = true;
        }
      }
      if (changed) this.set({ ...state, theirs });
      return;
    }
    const current = state.kind === 'editing' ? this.options.getFields() : state.saved;
    const mine: Partial<F> = {};
    const theirs: Partial<F> = {};
    let any = false;
    for (const field of Object.keys(current) as (keyof F)[]) {
      if (!(field in entity)) continue;
      const value = asText(entity[field as string]) as F[keyof F];
      if (value !== current[field]) {
        mine[field] = current[field];
        theirs[field] = value;
        any = true;
      }
    }
    if (any) this.set({ kind: 'conflicted', mine, theirs, editorOpen: state.kind === 'editing' });
  }

  /**
   * Save the user's own version again. Success: recentlySaved. Gone (410): the gone path. Any other
   * error: stays conflicted with `mine` kept, and the error is returned for the consumer to show.
   */
  useMine = async (): Promise<Error | null> => {
    const state = this.state;
    if (state.kind !== 'conflicted') return null;
    try {
      await this.options.save(state.mine);
    } catch (error) {
      if (error instanceof GoneError) {
        this.gone();
        return error;
      }
      return error instanceof Error ? error : new Error(String(error));
    }
    this.set({ kind: 'recentlySaved', saved: { ...state.theirs, ...state.mine } as F, savedAt: this.now() });
    return null;
  };

  /** Keep the other person's version: nothing is saved. */
  keepTheirs = (): void => {
    if (this.state.kind === 'conflicted') this.set({ kind: 'idle' });
  };

  private gone(): void {
    this.set({ kind: 'idle' });
    this.options.onGone();
  }
}

const guards = new Map<string, Set<EditGuard<GuardFields>>>();

/** Makes a guard receive live events for its key. Returns an unregister function. */
export function registerEditGuard<F extends GuardFields>(guard: EditGuard<F>): () => void {
  let set = guards.get(guard.key);
  if (!set) {
    set = new Set();
    guards.set(guard.key, set);
  }
  set.add(guard as unknown as EditGuard<GuardFields>);
  return () => {
    guards.get(guard.key)?.delete(guard as unknown as EditGuard<GuardFields>);
  };
}

/** dispatchEvent calls this for every applied event. */
export function notifyEditGuards(event: LiveEvent): void {
  const key = guardKeyFor(event);
  if (!key) return;
  for (const guard of guards.get(key) ?? []) guard.notify(event);
}

/** Test helper. */
export function clearEditGuardsForTests(): void {
  guards.clear();
}
