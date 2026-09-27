import { useSyncExternalStore } from 'react';

/*
 * Per-browser, per-workspace "link saved" flag (localStorage) and "remind me later" snooze
 * (sessionStorage, so it ends with the tab session). Keys hold only the non-secret workspace id
 * and values are only '1'. Storage that can't be used reads as "not saved, not snoozed", so the
 * reminder stays visible; nothing here ever throws.
 */

const SAVED_PREFIX = 'tdl:v1:linkSaved:';
const SNOOZED_PREFIX = 'tdl:v1:linkSnoozed:';

export const linkSavedKey = (workspaceId: string) => `${SAVED_PREFIX}${workspaceId}`;
export const linkSnoozedKey = (workspaceId: string) => `${SNOOZED_PREFIX}${workspaceId}`;

type Area = 'localStorage' | 'sessionStorage';

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function storage(area: Area): Storage | null {
  try {
    return window[area];
  } catch {
    return null;
  }
}

function readFlag(area: Area, key: string): boolean {
  const cacheKey = `${area}|${key}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = storage(area)?.getItem(key) === '1';
  } catch {
    value = false;
  }
  cache.set(cacheKey, value);
  return value;
}

function writeFlag(area: Area, key: string): void {
  try {
    storage(area)?.setItem(key, '1');
  } catch {
    // Unavailable or full: the flag stays unset and the reminder keeps showing.
  }
  cache.delete(`${area}|${key}`);
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key === null) {
    cache.clear();
  } else {
    cache.delete(`localStorage|${event.key}`);
    cache.delete(`sessionStorage|${event.key}`);
  }
  notify();
}

export function hasSavedLink(workspaceId: string): boolean {
  return readFlag('localStorage', linkSavedKey(workspaceId));
}

export function markLinkSaved(workspaceId: string): void {
  writeFlag('localStorage', linkSavedKey(workspaceId));
}

export function isSnoozed(workspaceId: string): boolean {
  return readFlag('sessionStorage', linkSnoozedKey(workspaceId));
}

export function snooze(workspaceId: string): void {
  writeFlag('sessionStorage', linkSnoozedKey(workspaceId));
}

/** Subscribes to flag changes in this tab and (through one shared `storage` listener) other tabs. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerAttached) {
    window.addEventListener('storage', onStorage);
    storageListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListenerAttached) {
      window.removeEventListener('storage', onStorage);
      storageListenerAttached = false;
    }
  };
}

/** True while this browser has neither saved the link nor snoozed the reminder this session. */
export function useLinkReminderVisible(workspaceId: string): boolean {
  const visible = () => !hasSavedLink(workspaceId) && !isSnoozed(workspaceId);
  return useSyncExternalStore(subscribe, visible, visible);
}

/** Test hook: drop cached reads (a fresh page load starts with an empty cache). */
export function resetLinkSavedCacheForTests(): void {
  cache.clear();
}
