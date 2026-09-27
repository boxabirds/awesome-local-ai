import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * The app's keyboard shortcuts (architecture section 12): the ONLY global keydown listener. It is
 * attached to `document` once, lazily, when the first shortcut registers. Stories 6 to 8 and 11
 * register through `useGlobalShortcut`; the `?` panel lists whatever is registered.
 */

export type ShortcutGroup = 'Tasks' | 'Navigation' | 'General';

export type ShortcutOptions = {
  description: string;
  group: ShortcutGroup;
  /** Disabled entries neither run nor show in the panel. Default true. */
  enabled?: boolean;
  /** Also run while focus is in a typing field. Default false. */
  allowInFields?: boolean;
  /** 'none': no Ctrl, Meta or Alt (default). 'mod': Meta on macOS, Ctrl elsewhere. */
  modifiers?: 'none' | 'mod';
  /**
   * Checked at key time (story 6): when it returns false the key is left alone entirely (not
   * handled, default not prevented), e.g. row shortcuts only while a task row has focus.
   */
  when?: (event: KeyboardEvent) => boolean;
};

export type ShortcutInfo = { key: string; description: string; group: ShortcutGroup; modifiers?: 'none' | 'mod' };

type Entry = {
  key: string;
  handler: { current: (event: KeyboardEvent) => void };
  opts: { current: ShortcutOptions };
};

const registry = new Map<string, Set<Entry>>();
/** Keys handled locally (e.g. by the task list) but listed in the panel. */
const described = new Map<string, ShortcutInfo>();
let listening = false;
const stats = { registrations: 0, unregistrations: 0 };

/** One key name for matching: single characters are lower-cased ('Q' and 'q' are the same key). */
export function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

const NON_TYPING_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * True when keystrokes on `el` type text: text-like inputs, textarea, select and contenteditable.
 * The single implementation in the app.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).tagName !== 'string') return false;
  const element = el as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !NON_TYPING_INPUT_TYPES.has((element as HTMLInputElement).type.toLowerCase());
  if (element.isContentEditable) return true;
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** A printable key that needs Shift on common layouts ('?', '!', ...): Shift is allowed for it. */
function isShiftedCharacter(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/i.test(key);
}

function modifiersMatch(event: KeyboardEvent, entry: Entry): boolean {
  const mode = entry.opts.current.modifiers ?? 'none';
  if (mode === 'mod') {
    const mac = isMac();
    const modHeld = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    return modHeld && !event.altKey && !event.shiftKey;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !event.shiftKey || isShiftedCharacter(entry.key);
}

function isEnabled(entry: Entry): boolean {
  return entry.opts.current.enabled !== false;
}

/** The document keydown listener. */
export function dispatchShortcut(event: KeyboardEvent): void {
  if (event.isComposing || event.defaultPrevented) return;
  const entries = registry.get(normaliseKey(event.key));
  if (!entries || entries.size === 0) return;
  const typing = isTypingTarget(event.target);
  // The most recently registered eligible entry wins (a view can override a global one).
  const candidates = [...entries].reverse();
  const match = candidates.find(
    (entry) =>
      isEnabled(entry) &&
      (!typing || entry.opts.current.allowInFields === true) &&
      modifiersMatch(event, entry) &&
      (entry.opts.current.when?.(event) ?? true),
  );
  if (!match) return;
  event.preventDefault();
  match.handler.current(event);
}

function register(entry: Entry): () => void {
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('keydown', dispatchShortcut);
    listening = true;
  }
  let set = registry.get(entry.key);
  if (!set) {
    set = new Set();
    registry.set(entry.key, set);
  }
  set.add(entry);
  stats.registrations++;
  return () => {
    const current = registry.get(entry.key);
    current?.delete(entry);
    if (current?.size === 0) registry.delete(entry.key);
    stats.unregistrations++;
  };
}

/**
 * Registers a global shortcut while the component is mounted. The handler and options are kept in
 * refs updated on every render, so re-rendering never re-registers.
 */
export function useGlobalShortcut(key: string, handler: (event: KeyboardEvent) => void, opts: ShortcutOptions): void {
  const handlerRef = useRef(handler);
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    handlerRef.current = handler;
    optsRef.current = opts;
  });
  const normalised = normaliseKey(key);
  useEffect(() => register({ key: normalised, handler: handlerRef, opts: optsRef }), [normalised]);
}

/** Lists a key that a component handles itself (not globally) in the shortcuts panel. */
export function describeShortcut(info: ShortcutInfo): void {
  described.set(`${info.group}:${info.key}`, info);
}

/** A snapshot of the enabled shortcuts (registered, then described), for the `?` panel. */
export function listShortcuts(): ShortcutInfo[] {
  const seen = new Set<string>();
  const out: ShortcutInfo[] = [];
  for (const [key, entries] of registry) {
    for (const entry of [...entries].reverse()) {
      if (!isEnabled(entry)) continue;
      const { description, group, modifiers } = entry.opts.current;
      const id = `${key}:${description}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(modifiers === 'mod' ? { key, description, group, modifiers } : { key, description, group });
      break;
    }
  }
  for (const info of described.values()) out.push(info);
  return out;
}

/** How a key is shown in the panel and menus ('q' as Q, ' ' as Space, mod+z as ⌘Z or Ctrl+Z). */
export function displayKey(key: string, modifiers: 'none' | 'mod' = 'none'): string {
  const base = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  if (modifiers !== 'mod') return base;
  return isMac() ? `⌘${base}` : `Ctrl+${base}`;
}

/** Test hooks: registration counters, and a fresh registry (as after a page load). */
export function shortcutStatsForTests(): Readonly<typeof stats> {
  return { ...stats };
}

export function resetShortcutsForTests(): void {
  registry.clear();
  if (listening && typeof document !== 'undefined') document.removeEventListener('keydown', dispatchShortcut);
  listening = false;
  stats.registrations = 0;
  stats.unregistrations = 0;
}
