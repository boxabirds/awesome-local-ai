/*
 * "Show completed" is remembered per workspace and list on this browser. Storage can be missing
 * or throw (private modes, blocked storage): reads then say false and writes are dropped, and
 * the toggle still works for the session.
 */

const keyFor = (workspaceId: string, listKey: string) => `tdl:showCompleted:${workspaceId}:${listKey}`;

export function readShowCompleted(storage: Storage | undefined, workspaceId: string, listKey: string): boolean {
  try {
    return storage?.getItem(keyFor(workspaceId, listKey)) === '1';
  } catch {
    return false;
  }
}

export function writeShowCompleted(storage: Storage | undefined, workspaceId: string, listKey: string, on: boolean): void {
  try {
    storage?.setItem(keyFor(workspaceId, listKey), on ? '1' : '0');
  } catch {
    // Not remembered; the choice still applies until the page is closed.
  }
}

/** window.localStorage, or undefined where even reading the property throws. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
