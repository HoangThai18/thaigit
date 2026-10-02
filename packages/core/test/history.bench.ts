// Bench: parseLog + computeGraphLayout trên 30k commit (mục tiêu mỗi bước < 300 ms trên Node, M1).
// Vitest 5: `bench` là fixture của test context. Chạy: `pnpm --filter @thaigit/core exec vitest bench --run`
// (file `*.bench.ts` không nằm trong `include` của `pnpm test`).
// Dữ liệu: nếu có `python3` + `git` thì sinh repo thật bằng fixtures/make-big-repo.py (30k commit, ~1.077 ref) rồi lấy
// output `git log -z` thật; không thì dùng log tổng hợp cùng cấu trúc (nhánh chính + tối đa 12 nhánh feature mở cùng lúc).

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { LOG_FORMAT, buildHistory, parseLog } from '../src/git/index.ts';
import { computeGraphLayout } from '../src/graph/index.ts';
import { isolatedConfig, rawGit } from './helpers/test-repo.ts';

const COMMITS = 30_000;
const US = '\u001f';

/** Log tổng hợp đúng định dạng `git log -z --format=LOG_FORMAT --date-order`: mới → cũ, con trước cha. */
function syntheticLog(count: number): Uint8Array {
  let state = 7;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const sha = (n: number) => n.toString(16).padStart(40, '0');
  const authors = ['Phan Thái', 'Lê Minh Châu', 'Nguyễn Văn An', 'Trần Thị Bình'];
  const records: string[] = [];
  let main = 1;
  const features = new Map<string, number>();
  let serial = 1;
  const emit = (id: number, parents: number[], subject: string) => {
    const author = authors[id % authors.length] ?? 'A';
    const time = 1_600_000_000 + id * 60;
    records.push(
      [
        sha(id),
        parents.map(sha).join(' '),
        author,
        `${author}@example.com`,
        time,
        author,
        `${author}@example.com`,
        time,
        subject,
      ].join(US),
    );
  };
  emit(1, [], 'Khởi tạo');
  for (let n = 1; n < count; n++) {
    const r = random();
    serial += 1;
    if (r < 0.03 && features.size < 12) {
      features.set(`f${n}`, serial);
      emit(serial, [main], `Bắt đầu feature f${n}`);
    } else if (r < 0.45 && features.size > 0) {
      const name = [...features.keys()][Math.floor(random() * features.size)] ?? '';
      const parent = features.get(name) ?? main;
      features.set(name, serial);
      emit(serial, [parent], `Làm tiếp ${name} #${n}`);
    } else if (r < 0.5 && features.size > 0) {
      const name = [...features.keys()][Math.floor(random() * features.size)] ?? '';
      const tip = features.get(name) ?? main;
      features.delete(name);
      emit(serial, [main, tip], `Merge branch '${name}'`);
      main = serial;
    } else {
      emit(serial, [main], `Sửa lỗi số ${n}`);
      main = serial;
    }
    if (records.length > 0 && features.size === 0 && n % 1000 === 0) main = serial;
  }
  // Mới → cũ (id tăng theo thời gian nên đảo ngược là thứ tự `--date-order`).
  return new TextEncoder().encode(`${records.reverse().join('\0')}\0`);
}

/** Repo thật 30k commit từ make-big-repo.py; null nếu thiếu python3/git hoặc lỗi. */
async function realLog(): Promise<Uint8Array | null> {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'make-big-repo.py');
  const dir = await mkdtemp(join(tmpdir(), 'thaigit-bench-'));
  try {
    const config = isolatedConfig();
    const stream = spawnSync('python3', [script], { maxBuffer: 1024 * 1024 * 1024 });
    if (stream.status !== 0) return null;
    rawGit(dir, ['init', '-q', '-b', 'main', '.'], config);
    rawGit(dir, ['fast-import', '--quiet'], config, new Uint8Array(stream.stdout));
    const out = spawnSync(
      'git',
      ['log', '-z', `--format=${LOG_FORMAT}`, '--date-order', '--branches', '--remotes', '--tags', '--'],
      { cwd: dir, maxBuffer: 1024 * 1024 * 1024 },
    );
    return out.status === 0 ? new Uint8Array(out.stdout) : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const real = await realLog();
const log = real ?? syntheticLog(COMMITS);
const commits = parseLog(log);
console.log(
  `[bench] nguồn: ${real ? 'repo thật (make-big-repo.py)' : 'log tổng hợp'} — ${commits.length} commit, ${(log.length / 1e6).toFixed(1)} MB`,
);

const BUDGET_MS = 300;

test(`30k commit (${real ? 'repo thật' : 'tổng hợp'}): parse, layout, và cả hai`, async ({ bench }) => {
  const results = await bench.compare(
    bench('parseLog', () => {
      parseLog(log);
    }),
    bench('computeGraphLayout', () => {
      computeGraphLayout(commits);
    }),
    bench('buildHistory (parse + WIP + layout)', () => {
      buildHistory(log, { limit: COMMITS, headOid: commits[0]?.id ?? null, showWorkingTree: true });
    }),
  );
  for (const name of ['parseLog', 'computeGraphLayout', 'buildHistory (parse + WIP + layout)'] as const) {
    const { mean, p99 } = results.get(name).latency;
    console.log(`[bench] ${name}: mean ${mean.toFixed(1)} ms, p99 ${p99.toFixed(1)} ms`);
  }
  // Ngân sách của phase 3: mỗi bước < 300 ms (trung bình).
  expect(results.get('parseLog').latency.mean).toBeLessThan(BUDGET_MS);
  expect(results.get('computeGraphLayout').latency.mean).toBeLessThan(BUDGET_MS);
});
