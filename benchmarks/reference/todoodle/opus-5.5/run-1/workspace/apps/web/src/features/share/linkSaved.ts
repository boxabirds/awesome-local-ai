import { useSyncExternalStore } from 'react';

/*
 * Per-browser, per-workspace flags (client-localstorage-schema: versioned keys, minimal data).
 * Keys contain only the non-secret workspace id and values are only '1': never the secret.
 */
const SAVED_PREFIX = 'tdl:v1:linkSaved:';
const SNOOZED_PREFIX = 'tdl:v1:linkSnoozed:';
const FLAG = '1';

export function linkSavedKey(workspaceId: string): string {
  return `${SAVED_PREFIX}${workspaceId}`;
}

export function linkSnoozedKey(workspaceId: string): string {
  return `${SNOOZED_PREFIX}${workspaceId}`;
}

type Area = 'localStorage' | 'sessionStorage';

/** Read cache (js-cache-storage), invalidated on every write and on 'storage' events from other tabs. */
const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

function readFlag(area: Area, key: string): boolean {
  const cacheKey = `${area}:${key}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = window[area].getItem(key) === FLAG;
  } catch {
    // Storage unavailable (private mode, blocked site data): report 'not saved' so the reminder stays.
  }
  cache.set(cacheKey, value);
  return value;
}

function writeFlag(area: Area, key: string): void {
  try {
    window[area].setItem(key, FLAG);
  } catch {
    // Storage unavailable: nothing persists; the banner keeps reminding.
  }
  cache.clear();
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(): void {
  cache.clear();
  notify();
}

export function hasSavedLink(workspaceId: string): boolean {
  return readFlag('localStorage', linkSavedKey(workspaceId));
}

/** The link was copied or emailed from this browser: hide the reminder for good. */
export function markLinkSaved(workspaceId: string): void {
  writeFlag('localStorage', linkSavedKey(workspaceId));
}

export function isSnoozed(workspaceId: string): boolean {
  return readFlag('sessionStorage', linkSnoozedKey(workspaceId));
}

/** 'Remind me later': hidden for this tab session only. */
export function snooze(workspaceId: string): void {
  writeFlag('sessionStorage', linkSnoozedKey(workspaceId));
}

/** One shared window 'storage' listener serves every subscriber (client-event-listeners). */
export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** True while this browser has neither saved nor snoozed the link. The snapshot is the boolean itself. */
export function useLinkReminderVisible(workspaceId: string): boolean {
  const visible = () => !hasSavedLink(workspaceId) && !isSnoozed(workspaceId);
  return useSyncExternalStore(subscribe, visible, visible);
}

/** Drops cached reads, as a fresh page load would (tests use it to simulate a new tab). */
export function clearLinkSavedCache(): void {
  cache.clear();
}
