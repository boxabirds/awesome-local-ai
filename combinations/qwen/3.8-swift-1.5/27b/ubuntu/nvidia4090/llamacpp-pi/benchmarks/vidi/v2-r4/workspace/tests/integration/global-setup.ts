import { startTestServer, stopTestServer } from './helpers/test-server.ts';

export default async function setup() {
  await startTestServer();
  return async function teardown() {
    await stopTestServer();
  };
}
