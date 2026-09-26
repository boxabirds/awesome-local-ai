import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * The app's ONLY global keydown listener (architecture §12, client-event-listeners). Stories 6, 7, 8 and 11
 * register their keys through useGlobalShortcut; the ? panel lists whatever is registered.
 */

export type ShortcutGroup = 'Tasks' | 'Navigation' | 'General';

export type ShortcutOptions = {
  description: string;
  group: ShortcutGroup;
  /** Default true. A disabled entry never fires and is not listed. */
  enabled?: boolean;
  /** Fire even while the user is typing in a field (default false: typing is never hijacked). */
  allowInFields?: boolean;
  /** 'none' (default): no Ctrl, Meta or Alt held. 'mod': Meta on macOS, Ctrl elsewhere. */
  modifiers?: 'none' | 'mod';
};

type Entry = {
  key: string;
  handler: { current: (event: KeyboardEvent) => void };
  options: { current: ShortcutOptions };
};

/** What the help panel shows for one shortcut. */
export type ShortcutInfo = { keys: string[]; description: string; group: ShortcutGroup };

const registry = new Map<string, Set<Entry>>();
const described: ShortcutInfo[] = [];
let listening = false;
const stats = { registers: 0, unregisters: 0 };

/** Letters are case-insensitive (Caps Lock); every other key is matched as the browser reports it. */
export function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** A printable character that needs Shift on most layouts (?, !, +…). Letters and digits are not. */
function isShiftedCharacter(key: string): boolean {
  return key.length === 1 && !/[a-z0-9\s]/i.test(key);
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);

/**
 * True when keys typed at `el` are text: text-like inputs, textareas, selects and contentEditable
 * elements. The single implementation in the app: shortcuts never fire there unless allowInFields.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type.toLowerCase());
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // happy-dom and some older engines don't compute isContentEditable.
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function modifiersMatch(event: KeyboardEvent, mode: 'none' | 'mod'): boolean {
  if (mode === 'mod') {
    const apple = isApplePlatform();
    const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    return mod && !event.altKey;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !event.shiftKey || isShiftedCharacter(event.key);
}

/**
 * Runs the most recently registered enabled entry for this key whose rules pass. Calls preventDefault
 * only when a handler runs. Exported for unit tests; the document listener calls it.
 */
export function dispatchShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.defaultPrevented) return false;
  const entries = registry.get(normaliseKey(event.key));
  if (!entries || entries.size === 0) return false;
  const typing = isTypingTarget(event.target);
  const candidates = [...entries];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const entry = candidates[i]!;
    const options = entry.options.current;
    if (options.enabled === false) continue;
    if (typing && !options.allowInFields) continue;
    if (!modifiersMatch(event, options.modifiers ?? 'none')) continue;
    event.preventDefault();
    entry.handler.current(event);
    return true;
  }
  return false;
}

function ensureListener(): void {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('keydown', dispatchShortcut);
  listening = true;
}

function register(entry: Entry): () => void {
  ensureListener();
  let set = registry.get(entry.key);
  if (!set) {
    set = new Set();
    registry.set(entry.key, set);
  }
  set.add(entry);
  stats.registers++;
  return () => {
    registry.get(entry.key)?.delete(entry);
    stats.unregisters++;
  };
}

/**
 * Registers a global keyboard shortcut for the component's lifetime. The handler and options are kept in
 * refs updated every render, so re-renders never re-register (advanced-event-handler-refs). When several
 * components register the same key, the most recently registered enabled one wins.
 */
export function useGlobalShortcut(key: string, handler: (event: KeyboardEvent) => void, options: ShortcutOptions): void {
  const handlerRef = useRef(handler);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    handlerRef.current = handler;
    optionsRef.current = options;
  });
  useEffect(() => register({ key: normaliseKey(key), handler: handlerRef, options: optionsRef }), [key]);
}

/** How a key is shown in the panel: letters upper-case (Q), everything else as is (?). */
function displayKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Lists a key a component handles itself (e.g. the task list's arrows) so the ? panel shows it. Static:
 * call it at module level. Adding the same entry twice has no effect.
 */
export function describeShortcut(info: ShortcutInfo): void {
  if (described.some((d) => d.description === info.description && d.keys.join() === info.keys.join())) return;
  described.push(info);
}

/** Every shortcut the panel shows: registered and enabled entries (one per key), then the described ones. */
export function listShortcuts(): ShortcutInfo[] {
  const registered: ShortcutInfo[] = [];
  for (const [key, entries] of registry) {
    const enabled = [...entries].filter((entry) => entry.options.current.enabled !== false);
    const winner = enabled[enabled.length - 1];
    if (!winner) continue;
    const { description, group, modifiers } = winner.options.current;
    const shown = displayKey(key);
    registered.push({ keys: modifiers === 'mod' ? [isApplePlatform() ? '⌘' : 'Ctrl', shown] : [shown], description, group });
  }
  return [...registered, ...described];
}

/** Test helpers: registration counters, and a full reset (listener included). */
export function shortcutStats(): { registers: number; unregisters: number } {
  return { ...stats };
}

export function resetShortcutsForTests(): void {
  registry.clear();
  if (listening) document.removeEventListener('keydown', dispatchShortcut);
  listening = false;
  stats.registers = 0;
  stats.unregisters = 0;
}
