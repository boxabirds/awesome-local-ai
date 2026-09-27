import { test } from '@playwright/test';

import { newBoardId } from '../../src/shared/board-id';
import { connectionState, withParticipants } from './helpers/participants';

test('two participants idle probe', async ({ browser }) => {
  test.setTimeout(180_000);
  await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const row: string[] = [];
      for (const person of [alex, sam]) {
        const t0 = Date.now();
        const outcome = await Promise.race([
          connectionState(person.page).then((v) => String(v)),
          new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 3_000)),
        ]);
        row.push(`${person.name}=${outcome}(${Date.now() - t0}ms)`);
      }
      console.log(`probe ${i}: ${row.join(' ')} closedA=${alex.page.isClosed()} closedB=${sam.page.isClosed()} urlA=${alex.page.url().slice(-12)} urlB=${sam.page.url().slice(-12)}`);
    }
  });
});
