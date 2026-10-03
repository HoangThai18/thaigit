// Lõi AI: lọc / quét bí mật / ngân sách token (trên git thật), đọc SSE, hoàn thiện chữ của model.

import { describe, expect, it } from 'vitest';
import {
  SseParser,
  buildDiffContext,
  classifyPath,
  estimateTokens,
  finalizeCommitMessage,
  finalizeMarkdown,
  findSecret,
  readAiFrames,
  stripThinking,
} from '../src/ai/index.ts';
import { parseDiff } from '../src/diff/index.ts';
import { numberedLines, withTestRepo } from './helpers/test-repo.ts';

const enc = new TextEncoder();

describe('classifyPath', () => {
  it('nhận ra lockfile, file sinh tự động và file nhạy cảm', () => {
    expect(classifyPath('pnpm-lock.yaml')).toBe('lockfile');
    expect(classifyPath('apps/desktop/src-tauri/Cargo.lock')).toBe('lockfile');
    expect(classifyPath('web/dist/app.js')).toBe('generated');
    expect(classifyPath('public/vendor.min.js')).toBe('generated');
    expect(classifyPath('node_modules/x/index.js')).toBe('generated');
    for (const path of [
      '.env',
      'config/.env.production',
      'deploy/server.pem',
      'keys/id_ed25519',
      '.npmrc',
      'credentials-prod.json',
      'infra/main.tfvars',
      'src/appsettings.Development.json',
      'home/.ssh/config',
    ]) {
      expect(classifyPath(path), path).toBe('sensitive');
    }
    expect(classifyPath('src/app.ts')).toBeNull();
    expect(classifyPath('docs/environment.md')).toBeNull();
  });
});

describe('findSecret', () => {
  it('bắt các mẫu tín hiệu cao', () => {
    expect(findSecret('const key = "AKIAIOSFODNN7EXAMPLE";')).toBe('aws-access-key');
    expect(findSecret(`token: ghp_${'a1B2'.repeat(9)}`)).toBe('github-token');
    expect(findSecret('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe('private-key');
    expect(findSecret('DATABASE_URL=postgres://admin:s3cr3tP4ss@db.local:5432/app')).toBe('url-password');
    expect(findSecret(`OPENAI=sk-proj-${'Ab3'.repeat(10)}`)).toBe('ai-api-key');
  });

  it('bắt chuỗi entropy cao gán cho biến tên nhạy cảm', () => {
    expect(findSecret('const API_KEY = "q8Zr2LxP0vNw7TkE4bYc";')).toBe('high-entropy-assignment');
    expect(findSecret('"client_secret": "Hx92-kLq0Pz7_Wm3"')).toBe('high-entropy-assignment');
  });

  it('không bắt nhầm code thường', () => {
    expect(findSecret('const password = req.body.password;')).toBeNull();
    expect(findSecret('token = getToken(user)')).toBeNull();
    expect(findSecret('API_KEY = process.env.API_KEY')).toBeNull();
    expect(findSecret('password: "changeme"')).toBeNull();
    expect(findSecret('const url = "https://github.com/HoangThai18/thaigit";')).toBeNull();
    expect(findSecret('secretName = "database_password"')).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('chữ có dấu tốn token hơn ASCII', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    expect(estimateTokens('Sửa lỗi đăng nhập')).toBeGreaterThan(estimateTokens('Sua loi dang nhap'));
  });
});

describe('buildDiffContext (git thật)', () => {
  it('không bao giờ gửi file nhạy cảm, lockfile, ảnh hay đoạn chứa bí mật', () =>
    withTestRepo(async (t) => {
      await t.write('src/app.ts', `${numberedLines(30).join('\n')}\n`);
      await t.commitAll('init');
      const lines = numberedLines(30);
      lines[2] = 'export const title = "Thaigit — xin chào";';
      lines[25] = `const leaked = "ghp_${'x9Y8'.repeat(9)}";`;
      await t.write('src/app.ts', `${lines.join('\n')}\n`);
      await t.write('.env', 'SECRET=abc\n');
      await t.write('keys/id_ed25519', 'không gửi\n');
      await t.write('.npmrc', '//registry.npmjs.org/:_authToken=x\n');
      await t.write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
      await t.write('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0, 3]));
      await t.write('src/config.ts', `export const AWS = "AKIAIOSFODNN7EXAMPLE";\n`);
      await t.repo.stageAll();

      const context = buildDiffContext(parseDiff(await t.repo.stagedDiffBytes()), 6000);
      const sent = JSON.stringify(context.files);
      expect(sent).not.toContain('ghp_');
      expect(sent).not.toContain('AKIA');
      expect(sent).not.toContain('không gửi');
      expect(sent).not.toContain('lockfileVersion');
      expect(sent).toContain('Thaigit — xin chào');
      expect(context.files.map((file) => file.path)).toEqual(['src/app.ts']);
      expect(context.files[0]?.truncated).toBe(true);
      const reasons = Object.fromEntries(context.skipped.map((file) => [file.path, file.reason]));
      expect(reasons).toEqual({
        '.env': 'sensitive',
        '.npmrc': 'sensitive',
        'keys/id_ed25519': 'sensitive',
        'logo.png': 'binary',
        'pnpm-lock.yaml': 'lockfile',
        'src/config.ts': 'secret',
      });
      expect(context.redactions.map((item) => item.rule).sort()).toEqual(['aws-access-key', 'github-token']);
    }));

  it('giữ Unicode, bỏ \\r cuối dòng, nhận ra đổi tên và file không phải UTF-8', () =>
    withTestRepo(async (t) => {
      await t.write('cũ.txt', `${numberedLines(20, 'dòng').join('\n')}\n`);
      await t.commitAll('init');
      await t.repo.stageAll();
      t.git('mv', 'cũ.txt', 'mới.txt');
      await t.write('crlf.txt', 'một\r\nhai\r\n');
      await t.write('latin1.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]));
      await t.repo.stageAll();

      const context = buildDiffContext(parseDiff(await t.repo.stagedDiffBytes()), 6000);
      const renamed = context.files.find((file) => file.path === 'mới.txt');
      expect(renamed).toMatchObject({ status: 'renamed', oldPath: 'cũ.txt' });
      const crlf = context.files.find((file) => file.path === 'crlf.txt');
      expect(crlf?.status).toBe('added');
      expect(crlf?.patch).toContain('+một\n+hai\n');
      expect(context.skipped).toContainEqual({
        path: 'latin1.txt',
        reason: 'undecodable',
        additions: 1,
        deletions: 0,
      });
    }));

  it('vượt ngân sách: file lớn bị rút gọn, hết chỗ thì chỉ gửi tên', () =>
    withTestRepo(async (t) => {
      await t.write('small.ts', 'export const a = 1;\n');
      const big = Array.from({ length: 40 }, (_, block) =>
        numberedLines(12, `khối ${block} dòng`).join('\n'),
      ).join('\n\n\n\n\n\n\n');
      await t.write('big.ts', `${big}\n`);
      await t.commitAll('init');
      await t.write('small.ts', 'export const a = 2;\n');
      await t.write('big.ts', `${big.replaceAll('dòng 5', 'DÒNG NĂM')}\n`);
      await t.repo.stageAll();

      const diffs = parseDiff(await t.repo.stagedDiffBytes());
      const roomy = buildDiffContext(diffs, 1000);
      expect(roomy.files.map((file) => file.path).sort()).toEqual(['big.ts', 'small.ts']);
      expect(roomy.files.find((file) => file.path === 'big.ts')?.truncated).toBe(true);
      expect(roomy.tokens).toBeLessThanOrEqual(1000);

      const tight = buildDiffContext(diffs, 40);
      expect(tight.files.map((file) => file.path)).toEqual(['small.ts']);
      expect(tight.skipped).toContainEqual(expect.objectContaining({ path: 'big.ts', reason: 'budget' }));
    }));
});

describe('Repository: ngữ cảnh cho AI', () => {
  it('recentSubjects, commitPatchBytes và branchDiffBytes', () =>
    withTestRepo(async (t) => {
      expect(await t.repo.recentSubjects()).toEqual([]);
      await t.write('a.txt', '1\n');
      await t.commitAll('Khởi tạo');
      await t.write('a.txt', '2\n');
      await t.commitAll('Đổi số');
      expect(await t.repo.recentSubjects(10)).toEqual(['Đổi số', 'Khởi tạo']);

      const head = t.git('rev-parse', 'HEAD').trim();
      const parent = t.git('rev-parse', 'HEAD~1').trim();
      const patch = new TextDecoder().decode(await t.repo.commitPatchBytes(head, parent));
      expect(patch).toContain('-1\n+2\n');

      t.git('switch', '-c', 'tinh-nang');
      await t.write('b.txt', 'mới\n');
      await t.commitAll('Thêm b');
      const branch = parseDiff(await t.repo.branchDiffBytes('main', 'tinh-nang'));
      expect(branch.map((file) => file.newPath)).toEqual(['b.txt']);
      expect(await t.repo.recentSubjects(10, 'tinh-nang', 'main')).toEqual(['Thêm b']);
    }));
});

describe('SseParser', () => {
  it('ghép frame bị cắt ngang, nhiều dòng data, CRLF tách đôi giữa hai chunk', () => {
    const parser = new SseParser();
    const raw =
      'event: delta\r\ndata: {"text":"Sửa"}\r\n\r\n: ping\n\nevent: done\ndata: {"usage":\ndata: {}}\n\n';
    const events = [];
    for (let index = 0; index < raw.length; index += 3)
      events.push(...parser.push(raw.slice(index, index + 3)));
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"Sửa"}' },
      { event: 'done', data: '{"usage":\n{}}' },
    ]);
    const split = new SseParser();
    expect(split.push('data: a\r')).toEqual([]);
    expect(split.push('\n\r\n')).toEqual([{ event: 'message', data: 'a' }]);
  });

  it('readAiFrames đọc stream byte (UTF-8 bị cắt giữa ký tự)', async () => {
    const bytes = enc.encode(
      'event: queued\ndata: {"position":2}\n\nevent: delta\ndata: {"text":"Thêm ✨"}\n\nevent: lạ\ndata: {}\n\nevent: done\ndata: {"usage":{"promptTokens":5,"completionTokens":2}}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 5)
          controller.enqueue(bytes.slice(index, index + 5));
        controller.close();
      },
    });
    const frames = [];
    for await (const frame of readAiFrames(stream)) frames.push(frame);
    expect(frames).toEqual([
      { type: 'queued', position: 2 },
      { type: 'delta', text: 'Thêm ✨' },
      { type: 'done', usage: { promptTokens: 5, completionTokens: 2 } },
    ]);
  });
});

describe('finalize', () => {
  it('bỏ <think>, fence, nhãn, nháy; tách tóm tắt và mô tả', () => {
    expect(
      finalizeCommitMessage(
        '<think>Người dùng đổi tiêu đề…</think>\n```\nCommit message: "Đổi tiêu đề trang chủ."\n\n- Sửa hero\n- Thêm chân trang\n```',
      ),
    ).toEqual({ summary: 'Đổi tiêu đề trang chủ', body: '- Sửa hero\n- Thêm chân trang' });
    expect(finalizeCommitMessage('feat(ai): viết commit bằng AI')).toEqual({
      summary: 'feat(ai): viết commit bằng AI',
      body: '',
    });
    expect(finalizeCommitMessage('   ')).toEqual({ summary: '', body: '' });
  });

  it('tóm tắt dài hơn 72 ký tự bị cắt ở ranh giới từ, phần dư xuống mô tả', () => {
    const long =
      'Thêm nút viết commit bằng AI vào ô soạn commit, có huỷ, tạo lại và hoàn tác về nội dung trước đó';
    const parts = finalizeCommitMessage(`${long}\n\nChi tiết.`);
    expect([...parts.summary].length).toBeLessThanOrEqual(72);
    expect(`${parts.summary} ${parts.body.split('\n\n')[0]}`).toBe(long);
    expect(parts.body.endsWith('Chi tiết.')).toBe(true);
  });

  it('stripThinking ẩn cả khối suy nghĩ đang mở dở khi stream', () => {
    expect(stripThinking('<think>đang nghĩ')).toBe('');
    expect(stripThinking('<think>a</think>Kết quả')).toBe('Kết quả');
    expect(finalizeMarkdown('```markdown\n## Tóm tắt\nNội dung\n```')).toBe('## Tóm tắt\nNội dung');
  });
});
