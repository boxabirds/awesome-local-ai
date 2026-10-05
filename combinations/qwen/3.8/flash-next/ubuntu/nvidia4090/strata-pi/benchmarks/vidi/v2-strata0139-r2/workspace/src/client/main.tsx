import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boardIdFromPath } from "./routing";
import { newBoardId } from "../shared/board-id";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");

/**
 * Which board to open.
 *
 * `/b/<boardId>` opens that board. `/` opens a new one — visiting a board is
 * how you create it until story 5 adds the board list, which is also what makes
 * two people land on the same board: they are given the same `/b/...` link.
 * A path that names no board at all is treated the same way rather than shown
 * an error screen.
 */
const boardId = boardIdFromPath(window.location.pathname) ?? newBoardId();

if (window.location.pathname === "/") {
  // Keep the address bar honest: the board this screen is on has an id.
  window.history.replaceState(null, "", `/b/${boardId}`);
}

createRoot(container).render(
  <StrictMode>
    <App boardId={boardId} />
  </StrictMode>,
);
