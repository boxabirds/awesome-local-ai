import { CONFLICT_RECENT_EDIT_WINDOW_MS } from '@todoodle/shared/limits';
import type { LiveEvent } from '@todoodle/shared/events';
import { GoneError } from '@/lib/errors';
import { clientId as thisClientId } from './clientId';

export type GuardFields = Record<string, string | null>;

export type Conflict<F extends GuardFields = GuardFields> = { mine: Partial<F>; theirs: Partial<F> };

export type GuardState =
  | { kind: 'idle' }
  | { kind: 'editing'; base: GuardFields }
  | { kind: 'recentlySaved'; saved: GuardFields; at: number }
  | { kind: 'conflicted'; mine: GuardFields; theirs: GuardFields; from: 'editing' | 'recentlySaved' };

export type EditGuardOptions = {
  /** 'workspace:<id>' | 'task:<id>' | 'project:<id>' */
  key: string;
  /** The current draft (while editing) or last saved values. */
  getFields: () => GuardFields;
  /** The entity was deleted: close the editor and tell the user. */
  onGone: () => void;
  now?: () => number;
  clientId?: string;
};

/** The guard key a live event is about (null for events about many entities). */
export function eventKey(event: LiveEvent): string | null {
  switch (event.type) {
    case 'workspace.updated':
      return `workspace:${event.entity.id}`;
    case 'project.upserted':
    case 'project.restored':
    case 'project.deleted':
      return `project:${event.entity.id}`;
    case 'task.upserted':
    case 'task.restored':
    case 'task.deleted':
      return `task:${event.entity.id}`;
    default:
      return null;
  }
}

function pick(source: Record<string, unknown>, keys: string[]): GuardFields {
  const out: GuardFields = {};
  for (const k of keys) out[k] = (source[k] ?? null) as string | null;
  return out;
}

function sameValues(a: GuardFields, b: GuardFields): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * Per-entity conflict state machine (live.conflict_notice). Server policy is last write wins;
 * this makes sure the person whose edit was replaced is told and chooses whose version to keep.
 *
 * - Idle ignores everything.
 * - Editing: another person's upsert that changes a field the user has also edited -> Conflicted
 *   (`mine` = the user's values of those fields, `theirs` = the event's). Fields the user hasn't
 *   touched just follow the cache. A deletion fires the gone path.
 * - RecentlySaved (within CONFLICT_RECENT_EDIT_WINDOW_MS of our own save): an upsert changing a
 *   saved field -> Conflicted; a deletion fires the gone path.
 * - Conflicted: a newer upsert updates only `theirs`; a deletion fires the gone path;
 *   useMine() saves `mine` again; keepTheirs() or closing the editor -> Idle.
 * Own echoes never change anything.
 */
export class EditGuard {
  readonly key: string;
  private state: GuardState = { kind: 'idle' };
  private conflict: Conflict | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly opts: EditGuardOptions;

  constructor(opts: EditGuardOptions) {
    this.opts = opts;
    this.key = opts.key;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable between changes (for useSyncExternalStore). */
  getConflict = (): Conflict | null => this.conflict;

  getState(): GuardState {
    this.expireRecentSave();
    return this.state;
  }

  /** The edit UI opened. */
  arm(): void {
    const kind = this.getState().kind;
    if (kind === 'idle' || kind === 'recentlySaved') this.setState({ kind: 'editing', base: { ...this.opts.getFields() } });
  }

  /** The edit UI closed. Closing while Conflicted counts as Keep theirs. */
  disarm(): void {
    const kind = this.state.kind;
    if (kind === 'editing' || kind === 'conflicted') this.setState({ kind: 'idle' });
  }

  /** Our own save succeeded with these values. */
  markSaved(saved: GuardFields): void {
    this.setState({ kind: 'recentlySaved', saved: { ...saved }, at: this.now() });
  }

  keepTheirs(): void {
    if (this.state.kind === 'conflicted') this.setState({ kind: 'idle' });
  }

  /** Saves `mine` again. Resolves with the error when it failed (null on success). */
  async useMine(save: (patch: GuardFields) => Promise<void>): Promise<unknown> {
    const state = this.state;
    if (state.kind !== 'conflicted') return null;
    try {
      await save({ ...state.mine });
    } catch (error) {
      if (error instanceof GoneError) this.gone();
      // Anything else: stay Conflicted with `mine` kept, so the user can try again.
      return error;
    }
    this.markSaved(state.mine);
    return null;
  }

  notify(event: LiveEvent): void {
    if (eventKey(event) !== this.key) return;
    if (event.originClientId !== null && event.originClientId === (this.opts.clientId ?? thisClientId)) return;
    const state = this.getState();
    if (state.kind === 'idle') return;
    if (event.type.endsWith('.deleted')) {
      this.gone();
      return;
    }
    const entity = event.entity as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(entity, k);

    if (state.kind === 'conflicted') {
      const theirs = pick(entity, Object.keys(state.mine).filter(has));
      const merged = { ...state.theirs, ...theirs };
      if (!sameValues(merged, state.theirs)) this.setState({ ...state, theirs: merged });
      return;
    }

    let mineValues: GuardFields;
    let changed: string[];
    if (state.kind === 'editing') {
      mineValues = this.opts.getFields();
      // A conflict needs both sides to have changed the field (from its value when editing
      // began) to different values; fields the user hasn't touched just take the new value.
      changed = Object.keys(mineValues).filter(
        (k) => has(k) && mineValues[k] !== state.base[k] && entity[k] !== state.base[k] && entity[k] !== mineValues[k],
      );
    } else {
      mineValues = state.saved;
      changed = Object.keys(mineValues).filter((k) => has(k) && entity[k] !== mineValues[k]);
    }
    if (changed.length === 0) return;
    this.setState({
      kind: 'conflicted',
      mine: pick(mineValues, changed),
      theirs: pick(entity, changed),
      from: state.kind,
    });
  }

  private gone() {
    this.setState({ kind: 'idle' });
    this.opts.onGone();
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private expireRecentSave() {
    if (this.state.kind === 'recentlySaved' && this.now() - this.state.at >= CONFLICT_RECENT_EDIT_WINDOW_MS) {
      this.setState({ kind: 'idle' });
    }
  }

  private setState(next: GuardState) {
    this.state = next;
    const conflict = next.kind === 'conflicted' ? { mine: next.mine, theirs: next.theirs } : null;
    if (conflict === null && this.conflict === null) return;
    this.conflict = conflict;
    for (const listener of this.listeners) listener();
  }
}

const guards = new Map<string, Set<EditGuard>>();

/** The registry dispatchEvent notifies. */
export const editGuards = {
  add(guard: EditGuard): () => void {
    let set = guards.get(guard.key);
    if (!set) {
      set = new Set();
      guards.set(guard.key, set);
    }
    set.add(guard);
    return () => {
      set.delete(guard);
      if (set.size === 0) guards.delete(guard.key);
    };
  },
  notify(event: LiveEvent): void {
    const key = eventKey(event);
    if (key === null) return;
    for (const guard of guards.get(key) ?? []) guard.notify(event);
  },
};
