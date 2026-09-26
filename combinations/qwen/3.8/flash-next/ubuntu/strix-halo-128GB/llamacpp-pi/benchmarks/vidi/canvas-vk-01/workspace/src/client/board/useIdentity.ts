import { useState } from 'react';

/**
 * The local user's identity (a stable id for this browser session), used as
 * `createdBy` on new objects. The full presence identity arrives with story 6;
 * until then this is the minimal session-scoped stand-in, deliberately shaped
 * the same so callers do not change.
 */
const STORAGE_KEY = 'vidi6-identity';

let cached: string | null = null;

function newIdentityId(): string {
  if (cached !== null) {
    return cached;
  }
  let id: string | null = null;
  try {
    id = globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    id = null;
  }
  if (id === null || id.length === 0) {
    id = `g_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      globalThis.sessionStorage?.setItem(STORAGE_KEY, id);
    } catch {
      // private mode: session-only id, regenerated per load
    }
  }
  cached = id;
  return id;
}

export interface Identity {
  id: string;
}

export function useIdentity(): Identity {
  const [identity] = useState<Identity>(() => ({ id: newIdentityId() }));
  return identity;
}
