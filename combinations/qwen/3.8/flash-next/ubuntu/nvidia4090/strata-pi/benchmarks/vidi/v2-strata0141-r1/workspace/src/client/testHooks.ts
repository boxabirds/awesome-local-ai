import type { Camera } from './canvas/camera';
import type { StickyColor } from '../shared/config';
import type { StickySnapshot } from '../shared/board-model';

/** Test-only note creation arguments, mirroring `createSticky`. */
export interface TestStickyParams {
  at: { x: number; y: number };
  color?: StickyColor;
}

export interface Vidi6TestHooks {
  /** Jump the camera anywhere on the board (used by e2e "far travel" tests). */
  setCamera(camera: Camera): void;
  /** Read the current camera. */
  getCamera(): Camera | null;
  /** The live document, topmost last (story 2 e2e). */
  notes(): StickySnapshot[];
  /** Put a note on the board through the model, for test setup. */
  createNote(params: TestStickyParams): string;
  /** The connection state the status badge is rendering (story 3). */
  connectionState(): string;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

type CameraApi = {
  set: (camera: Camera) => void;
  get: () => Camera;
};

let cameraApi: CameraApi | null = null;

/** Called by useCamera while mounted; pass null on unmount. */
export function registerCameraApi(api: CameraApi | null): void {
  cameraApi = api;
}

export interface BoardApi {
  notes: () => StickySnapshot[];
  createNote: (params: TestStickyParams) => string;
  connectionState: () => string;
}

let boardApi: BoardApi | null = null;

/** Called by App while mounted; pass null on unmount. */
export function registerBoardApi(api: BoardApi | null): void {
  boardApi = api;
}

/** Installs `window.__vidi6` only in the test build (never in production). */
export function installTestHooks(): void {
  if (import.meta.env.MODE !== 'test') {
    return;
  }
  window.__vidi6 = {
    setCamera: (camera) => cameraApi?.set(camera),
    getCamera: () => cameraApi?.get() ?? null,
    notes: () => boardApi?.notes() ?? [],
    createNote: (params) => boardApi?.createNote(params) ?? '',
    connectionState: () => boardApi?.connectionState() ?? 'connecting',
  };
}
