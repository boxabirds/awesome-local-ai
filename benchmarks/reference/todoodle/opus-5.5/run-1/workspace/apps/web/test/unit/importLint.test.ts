import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: webRoot, overrideConfigFile: path.join(webRoot, 'eslint.config.js') });

async function errorsFor(code: string, file = 'src/fixture.tsx'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(webRoot, file) });
  return (result?.messages ?? []).map((m) => `${m.ruleId}: ${m.message}`);
}

describe('TC-91 direct-import lint rule', () => {
  it.each([
    "import { Plus } from 'lucide-react';",
    "import { SharePanelLazy } from '@/features/share';",
    "import { SharePanelLazy } from '@/features/share/index';",
    "import { x } from '@/features/share/index.ts';",
    "import { format } from 'date-fns';",
    "import { format } from 'date-fns/format';",
  ])('rejects %s', async (code) => {
    const errors = await errorsFor(code);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^@typescript-eslint\/no-restricted-imports/);
  });

  it.each([
    "import Plus from 'lucide-react/icons/plus';",
    "import type { LucideIcon } from 'lucide-react';",
    "import { SharePanelLazy } from '@/features/share/SharePanelLazy';",
    "import { useWorkspaceLink } from '@/features/share/useWorkspaceLink';",
    "import { cn } from '@/lib/utils';",
  ])('accepts %s', async (code) => {
    expect(await errorsFor(code)).toEqual([]);
  });

  it('allows date-fns only inside src/features/dates/picker/**', async () => {
    const code = "import { format } from 'date-fns';";
    expect(await errorsFor(code, 'src/features/dates/picker/Picker.tsx')).toEqual([]);
    expect(await errorsFor("import { Plus } from 'lucide-react';", 'src/features/dates/picker/Picker.tsx')).toHaveLength(1);
  });

  it('the app source passes the rule', async () => {
    const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
    const problems = results.flatMap((r) => r.messages.map((m) => `${path.relative(webRoot, r.filePath)}: ${m.message}`));
    expect(problems).toEqual([]);
  });
});
