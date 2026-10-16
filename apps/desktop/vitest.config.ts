import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Hai dự án test:
//  - `node`: logic thuần (cột, nhãn, cây nhánh, thời gian) và store `.svelte.ts` (rune biên dịch bởi plugin Svelte) trên Node,
//    không cần DOM. Test dùng git thật trong thư mục tạm qua `@thaigit/core/node`.
//  - `dom`: mount component Svelte thật trong happy-dom (điều kiện `browser` để Svelte nạp bản client, rune có phản ứng thật) cho
//    các lỗi chỉ thấy trên DOM (khoá `{#each}` trùng, ARIA, focus, bàn phím). Chỉ gồm `test/dom/**`.
export default defineConfig({
  plugins: [svelte()],
  test: {
    // Git-backed tests spawn many processes; the Windows CI runner is several times slower at that.
    testTimeout: process.platform === 'win32' ? 60_000 : 20_000,
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['test/**/*.test.ts'], exclude: ['test/dom/**'] },
      },
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: { name: 'dom', include: ['test/dom/**/*.test.ts'], environment: 'happy-dom' },
      },
    ],
  },
});
