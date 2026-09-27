// Top-level layout: the board fills the window, the zoom controls sit bottom-right
// and the first-use hint bottom-centre (both rendered by BoardViewport's overlay).
import type { JSX } from "react";

import { BoardViewport } from "./canvas/BoardViewport";

export function App(): JSX.Element {
  return (
    <main className="vidi6-app">
      {/* Board content (sticky notes, shapes, ...) arrives in story 2. */}
      <BoardViewport />
    </main>
  );
}
