import { buildBoardUpdates, retroBoardSpecs } from '../tests/fixtures/boards';
const { updates } = buildBoardUpdates(retroBoardSpecs());
process.stdout.write(JSON.stringify(updates));
