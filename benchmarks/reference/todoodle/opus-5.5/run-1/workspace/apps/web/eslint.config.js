// Direct (non-barrel) imports only (architecture §12, bundle-barrel-imports).
import tseslint from 'typescript-eslint';

const LUCIDE_ROOT = {
  name: 'lucide-react',
  message: "Import icons one by one: `import X from 'lucide-react/icons/x'`.",
  // Types (e.g. LucideIcon) cost nothing at runtime.
  allowTypeImports: true,
};

const FEATURE_DIRECTORY = {
  regex: '^@/features/[^/]+(/index(\\.tsx?)?)?$',
  message: 'Import the file you need (e.g. `@/features/share/SharePanel`), not a feature directory or index.',
};

const DATE_FNS = {
  regex: '^date-fns(/.*)?$',
  message: 'date-fns is only allowed in src/features/dates/picker/**.',
};

const PICKER = 'src/features/dates/picker/**';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [LUCIDE_ROOT], patterns: [FEATURE_DIRECTORY, DATE_FNS] }],
    },
  },
  {
    files: [PICKER],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [LUCIDE_ROOT], patterns: [FEATURE_DIRECTORY] }],
    },
  },
];
