import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';

import { BoardDocProvider } from '../../src/client/board/useBoardDoc';
import { CameraProvider } from '../../src/client/canvas/useCamera';
import { createSticky, initDoc } from '../../src/shared/board-model';

/**
 * Renders a board harness with the doc provider, camera provider, and
 * a custom children tree. Returns the Y.Doc for assertions.
 */
export function renderBoardWithDoc(children?: ReactNode) {
  const doc = new Y.Doc();
  initDoc(doc);

  const view = render(
    <CameraProvider>
      <BoardDocProvider key={Math.random()}>
        {children}
      </BoardDocProvider>
    </CameraProvider>,
  );

  return { ...view, doc };
}

/**
 * Creates a note on the doc and returns its id.
 */
export function createTestNote(doc: Y.Doc, at = { x: 400, y: 400 }): string {
  return createSticky(doc, at);
}

/**
 * Wait for React to process pending state updates.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
