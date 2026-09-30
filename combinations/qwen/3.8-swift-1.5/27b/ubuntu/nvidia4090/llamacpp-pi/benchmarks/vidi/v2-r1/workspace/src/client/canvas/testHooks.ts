import { Camera } from '@client/canvas/camera';
import { createSticky, getStickyText } from '@shared/board-model';
import type * as Y from 'yjs';

interface CameraApi {
  camera: Camera;
  setCamera?: (cam: Camera) => void;
}

export interface SeedNote {
  x: number;
  y: number;
  text?: string;
  color?: 'yellow' | 'blue' | 'green' | 'pink';
}

export function setupTestHooks(cam: CameraApi, doc?: Y.Doc) {
  // Test hook available in all builds for e2e testing
  // In a production deployment, this would be gated behind a flag
  (window as any).__vidi6 = {
    setCamera: (x: number, y: number, zoom: number) => {
      cam.setCamera?.({ x, y, zoom });
    },
    getCamera: () => cam.camera,
    /**
     * Story 7: seed a board with sticky notes (centred on the given world
     * points). Returns the created ids. Deterministic seeding for e2e
     * instead of double-clicking.
     */
    seedNotes: (notes: SeedNote[]): string[] => {
      const ids: string[] = [];
      if (!doc) return ids;
      for (const n of notes) {
        const id = createSticky(doc, { x: n.x, y: n.y }, n.color);
        if (id) {
          ids.push(id);
          if (n.text) {
            getStickyText(doc, id)?.insert(0, n.text);
          }
        }
      }
      return ids;
    },
  };
}
