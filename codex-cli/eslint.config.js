import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  // Base ESLint recommended rules
  eslint.configs.recommended,
  
  // Configuration for JavaScript files (including this config file)
  {
    files: ['**/*.{js,mjs,cjs}'],
    ignores: [
      'dist/**',
      'node_modules/**'
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly'
      }
    },
    rules: {
      'no-console': 'off', // Allow console in config files
    }
  },
  
  // Main configuration for TypeScript files
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '.eslintrc.cjs',
      'eslint.config.js',
      'build.mjs',
      'dist/**',
      'vite.config.ts',
      'src/components/vendor/**',
      'node_modules/**'
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        project: ['./tsconfig.json'],
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        
        // Timer functions
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        
        // Web/Fetch APIs
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        
        // Browser APIs
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        crypto: 'readonly',
        
        // React/JSX
        JSX: 'readonly',
        React: 'readonly',
        
        // Node.js types namespace
        NodeJS: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'import': importPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'generic' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          allowDefaultCaseForExhaustiveSwitch: false,
          requireDefaultForNonUnion: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Import rules
      'import/no-cycle': ['error', { maxDepth: 1 }],
      'import/no-duplicates': 'error',
      'import/order': [
        'error',
        {
          groups: ['type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: false,
          },
        },
      ],

      // Core ESLint rules
      'no-unused-vars': 'off', // Use TypeScript version instead
      'sort-imports': 'off', // Use import plugin instead
      'curly': 'error',
      'eqeqeq': ['error', 'always', { null: 'never' }],
      'no-await-in-loop': 'error',
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-eval': 'error',
      'no-ex-assign': 'error',
      'no-return-await': 'error',
      'no-param-reassign': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-unsafe-finally': 'error',
      'no-var': 'error',

      // React rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true },
      ],
    },
  },

  // Test files configuration
  {
    files: ['tests/**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'import/order': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-await-in-loop': 'off',
      'no-control-regex': 'off',
      'no-console': 'off', // Allow console in tests
    },
  },
]; 