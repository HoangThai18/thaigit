import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Test logic thuần (cột, nhãn, cây nhánh, thời gian) và store `.svelte.ts` (rune biên dịch bởi plugin Svelte) trên Node:
// không cần DOM. Test dùng git thật trong thư mục tạm qua `@thaigit/core/node`.
export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
