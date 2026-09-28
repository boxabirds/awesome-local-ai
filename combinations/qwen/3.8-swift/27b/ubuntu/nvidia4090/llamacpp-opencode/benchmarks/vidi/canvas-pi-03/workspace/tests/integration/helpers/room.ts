/**
 * Creates a BoardRoomCore instance directly (no DurableObject base, no DO
 * storage) so integration tests exercise the real room logic + real
 * WebSockets + real Yjs without workerd writing per-object storage files.
 */
import { BoardRoomCore } from 'src/worker/board-room';

export function createRoom(): BoardRoomCore {
  return new BoardRoomCore();
}
