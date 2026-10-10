import { useMemo } from 'react';

/**
 * This client's id, for the `createdBy` a new object carries.
 *
 * Story 6 owns identity - colour, badge, display name - and is not implemented in
 * this build. Text objects still need an owner in the document (story 9's `text.create`
 * schema, and the e2e check that a created object records who made it), so this is a
 * plain anonymous id: stable for the lifetime of this tab, random per tab, kept in
 * `sessionStorage` so a reload recognises the same client. It is deliberately **not**
 * in the document: nothing here claims who a person is beyond "the same writes as
 * before".
 *
 * When story 6 lands, it replaces this one call and `createdBy` becomes a real identity.
 */

const STORAGE_KEY = 'vidi6:client-id';

function newId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(8);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `c_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`;
}

/** Read this tab's id, creating it once. */
export function clientId(): string {
  let stored: string | null = null;
  try {
    stored = globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    stored = null; // storage disabled (private mode): a per-load id is fine
  }
  if (stored) {
    return stored;
  }
  const id = newId();
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // Ignored: the id still works for this load.
  }
  return id;
}

export function useClientId(): string {
  return useMemo(clientId, []);
}
