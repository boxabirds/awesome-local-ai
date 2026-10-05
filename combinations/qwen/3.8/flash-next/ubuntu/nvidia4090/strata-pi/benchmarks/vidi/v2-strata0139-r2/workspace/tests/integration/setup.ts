import { afterEach } from "vitest";
import { abortAllDurableObjects, reset } from "cloudflare:test";

/**
 * Integration tests run inside workerd against the real Worker and the real
 * BoardRoom class. Nothing may leak between tests: Durable Object instances
 * (and the board documents they hold in memory) are torn down after each one.
 */

afterEach(async () => {
  // Close every room instance (and its sockets) before deleting its storage.
  await abortAllDurableObjects();
  await reset();
});
