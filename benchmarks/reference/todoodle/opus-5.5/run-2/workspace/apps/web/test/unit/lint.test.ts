// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: webRoot });

async function restricted(code: string, filePath = 'src/fixture.tsx') {
  const [result] = await eslint.lintText(code, { filePath: `${webRoot}${filePath}` });
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports').length;
}

describe('direct-import lint rule', () => {
  it.each([
    ["import { Plus } from 'lucide-react';"],
    ["import { SharePanel } from '@/features/share';"],
    ["import { SharePanel } from '@/features/share/';"],
    ["import { SharePanel } from '@/features/share/index';"],
    ["import { format } from 'date-fns';"],
  ])('TC-91 rejects %s', async (code) => {
    expect(await restricted(code)).toBe(1);
  });

  it.each([
    ["import Plus from 'lucide-react/icons/plus';"],
    ["import { SharePanel } from '@/features/share/SharePanel';"],
    ["import type { LucideIcon } from 'lucide-react';"],
    ["import { Button } from '@/components/ui/button';"],
  ])('TC-91 accepts %s', async (code) => {
    expect(await restricted(code)).toBe(0);
  });

  it('TC-91 allows date-fns only inside features/dates/picker', async () => {
    expect(await restricted("import { format } from 'date-fns';", 'src/features/dates/picker/Picker.tsx')).toBe(0);
  });

  it('TC-91 the app source passes the rule', async () => {
    const results = await eslint.lintFiles(['src']);
    expect(results.flatMap((r) => r.messages)).toEqual([]);
  });
});
