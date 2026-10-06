import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./router";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");

/**
 * The page is chosen by the URL (`router.tsx`): `/` is home, `/b/<boardId>` is a
 * board, anything else is Board not found.
 *
 * Story 3 redirected `/` to a new board id, which is how visiting an address
 * created a board. Story 5 removes that: a board exists only if the server made
 * one, so opening a link that names no board is an error page, not a board.
 */
createRoot(container).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
