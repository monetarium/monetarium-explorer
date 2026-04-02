import js from '@eslint/js'
import pluginImport from 'eslint-plugin-import'
import pluginPromise from 'eslint-plugin-promise'

export default [
  // ignore patterns (replaces .eslintignore)
  {
    ignores: ['public/dist/**', 'public/js/vendor/**', 'node_modules/**']
  },

  js.configs.recommended,

  {
    plugins: {
      import: pluginImport,
      promise: pluginPromise
    },

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        navigator: 'readonly',
        Notification: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        require: 'readonly'
      }
    },

    rules: {
      // --- possible errors / correctness ---
      'no-console': 'off',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-shadow': 'warn',

      // --- best practices ---
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'prefer-arrow-callback': 'error',
      'object-shorthand': ['error', 'consistent'],
      'array-callback-return': 'error',
      'no-return-assign': 'error',
      'no-throw-literal': 'error',
      'default-case': 'warn',

      // --- style (non-formatting — Prettier owns whitespace/quotes) ---
      'prefer-template': 'error',
      'no-useless-concat': 'error',

      // --- imports ---
      'import/no-duplicates': 'error',
      'import/no-unused-modules': 'warn',
      'import/order': ['warn', { 'newlines-between': 'never' }],

      // --- promises ---
      'promise/always-return': 'warn',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': ['warn', { allowFinally: true }]
    }
  },

  // test files — relax some rules
  {
    files: ['**/*.test.js'],
    rules: {
      'no-unused-vars': 'warn',
      'import/no-unused-modules': 'off',
      'promise/always-return': 'off',
      'promise/catch-or-return': 'off'
    }
  }
]
