export const INTEGRATION_PORT = 8801;
export const BASE_URL = `http://127.0.0.1:${INTEGRATION_PORT}`;

/** The WebSocket URL for a board's room. */
export function wsUrl(boardId: string): string {
  return `ws://127.0.0.1:${INTEGRATION_PORT}/api/rooms/${boardId}`;
}
