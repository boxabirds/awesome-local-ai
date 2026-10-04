import type { Camera } from './canvas/camera';

/**
 * Test-only hooks used by the e2e suite: jumping the camera to a part of the board too far
 * to drag to, and losing the connection to the room. They are compiled away in production
 * builds because `import.meta.env.MODE` is statically replaced with the mode string
 * ("production" for `npm run build`, "test" for `npm run build:test`), and
 * `npm run check:no-test-hook` fails a production build that mentions them anyway.
 */
export interface Vidi6TestHooks {
  setCamera(camera: Partial<Camera>): void;
  /** Lose the connection to the room the way a dead network would, and start trying again. */
  dropConnection(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/**
 * Add one capability to the test hooks and hand back the way to take it off again.
 *
 * The hooks live on one object that everybody shares, and each hook only ever touches its
 * own entry on it: the camera hook and the connection hook are registered by different parts
 * of the client at different times, and one of them stopping must not take the other away.
 */
function addHook(name: keyof Vidi6TestHooks, hook: Vidi6TestHooks[typeof name]): () => void {
  if (!IS_TEST_MODE) {
    return () => {};
  }
  // The bag is treated as a bag of things here: the two hooks have different signatures, and
  // what this function needs to do with them - put one in, compare it with itself on the way
  // out - says nothing about what they take.
  const hooks = (window.__vidi6 ??= {} as Vidi6TestHooks) as unknown as Record<string, unknown>;
  const key: string = name;
  const previous = hooks[key];
  hooks[key] = hook;
  return () => {
    const current = window.__vidi6 as unknown as Record<string, unknown> | undefined;
    if (current === hooks && hooks[key] === hook) {
      if (previous === undefined) {
        delete hooks[key];
      } else {
        hooks[key] = previous;
      }
      if (Object.keys(hooks).length === 0) {
        delete window.__vidi6;
      }
    }
  };
}

export function registerCameraHook(setCamera: (camera: Partial<Camera>) => void): () => void {
  return addHook('setCamera', setCamera);
}

export function registerConnectionHook(dropConnection: () => void): () => void {
  return addHook('dropConnection', dropConnection);
}
