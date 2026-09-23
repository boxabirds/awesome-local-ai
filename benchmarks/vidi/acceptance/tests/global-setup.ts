import { AppServer, controlServer } from './app-server';

export default async function globalSetup() {
  const workspace = process.env.WORKSPACE;
  if (!workspace) throw new Error('WORKSPACE env var not set');
  const app = new AppServer(workspace);
  try {
    await app.start();
  } catch (e) {
    // Do not abort the run: an app that cannot start must FAIL every applicable
    // test (each one's navigation is refused), not report zero tests.
    console.error(`[acceptance] app did not start: ${e}`);
    await app.stop();
  }
  const control = controlServer(app);
  // Returned function is Playwright's global teardown.
  return async () => {
    control.close();
    await app.stop();
  };
}
