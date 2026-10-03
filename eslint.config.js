// ESLint cho mã TS / Svelte / JS của cả workspace (apps/desktop, packages, server, site, scripts). Rust dùng clippy, Swift
// không lint. Chạy: `pnpm lint` (sửa tự động được thì `pnpm lint --fix`).
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './apps/desktop/svelte.config.js';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/target/',
    '**/.build/',
    'build/',
    'plans/',
    'Sources/',
    'Tests/',
    'apps/desktop/src-tauri/',
    'site/.next/',
    'site/out/',
    'site/next-env.d.ts',
  ]),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Tiền tố `_` = cố ý không dùng (tham số đứng giữa, như `failed(_error, reset)` của svelte:boundary).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Output của git được tách bằng \x00 / \x1f (`-z`, `--format=%x1f`): regex có ký tự điều khiển là cố ý.
      'no-control-regex': 'off',
      // Store cố ý dùng Map/Set thường: hoặc là chỉ mục nội bộ không phản ứng, hoặc theo lối "chép ra Map mới rồi gán lại"
      // vào `$state.raw`. SvelteMap/SvelteSet sẽ thêm theo dõi phản ứng không cần thiết trên repo hàng chục nghìn commit.
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'], svelteConfig },
    },
    // TypeScript đã kiểm tên chưa khai báo (svelte-check); `no-undef` không hiểu kiểu TS trong `<script lang="ts">`.
    rules: { 'no-undef': 'off' },
  },
);
