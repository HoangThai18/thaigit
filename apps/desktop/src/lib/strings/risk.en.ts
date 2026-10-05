/** Bản tiếng Anh của `risk.vi.ts` (cùng khoá, cùng tham số). */
import type { risk as source } from './risk.vi.ts';
import type { Translation } from './types.ts';

const files = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;

export const risk: Translation<typeof source> = {
  title: 'Worth a look before you commit',
  hint: 'Just a warning — Thaigit won’t block the commit.',
  dismiss: 'Hide this warning (it comes back when something new is flagged)',
  testsRemoved: (count: number) => `${files(count)} of tests deleted`,
  testsSkipped: (count: number) => `Tests skipped or narrowed (skip / only) in ${files(count)}`,
  depsChanged: (count: number) => `Dependencies changed (${files(count)})`,
  ciChanged: (count: number) => `CI / Docker changed (${files(count)})`,
  largeFile: (count: number) => `${files(count)} larger than 1 MB`,
  secret: (count: number) => `${files(count)} may contain a password or secret key`,
  more: (count: number) => `and ${files(count)} more`,
};
