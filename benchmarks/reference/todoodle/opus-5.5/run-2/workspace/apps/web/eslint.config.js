// Lint for the web app: enforces direct (non-barrel) imports (architecture section 12).
import tseslint from 'typescript-eslint';

const barrelRules = (allowDateFns) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'lucide-react',
          allowTypeImports: true,
          message: "Import each icon by path, e.g. 'lucide-react/icons/plus', not the package root.",
        },
      ],
      patterns: [
        {
          regex: '^@/features/[^/]+/?$',
          message: 'Import the file you need (e.g. @/features/share/SharePanel), not a feature directory.',
        },
        {
          regex: '^@/features/.+/index(\\.[jt]sx?)?$',
          message: 'features/* have no index barrels: import the file you need.',
        },
        ...(allowDateFns
          ? []
          : [{ regex: '^date-fns(/.*)?$', message: 'date-fns is only used inside src/features/dates/picker.' }]),
      ],
    },
  ],
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: barrelRules(false),
  },
  {
    files: ['src/features/dates/picker/**/*.{ts,tsx}'],
    rules: barrelRules(true),
  },
);
