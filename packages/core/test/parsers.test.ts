import { describe, expect, it } from 'vitest';
import {
  changedFileCount,
  classifyGitPath,
  commitBody,
  commitSummary,
  conflictDescription,
  conflictHasMarkers,
  defaultCloneDirectoryName,
  fileChangeAllPaths,
  fileChangeDirectory,
  fileChangeName,
  headBranchName,
  headOid,
  isAnnotatedTag,
  isDetachedHead,
  isMergeCommit,
  isStatusClean,
  isUnbornHead,
  isWorkingTreeCommit,
  operationCanContinue,
  operationCanSkip,
  operationShortName,
  operationTitle,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
  progressFraction,
  refName,
  refRemoteName,
  refShortBranchName,
  shortSha,
  stashBranchName,
  stashDisplayMessage,
  workingTreeCommit,
  type Stash,
} from '../src/git/index.ts';
import { unquoteGitPath } from '../src/git/parsers.ts';

const enc = new TextEncoder();
const US = '\u001f';

describe('Parsers (port ParserTests.swift)', () => {
  it('parsesPorcelainV2Status', () => {
    const records = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head feature/xin-chào',
      '# branch.upstream origin/feature/xin-chào',
      '# branch.ab +2 -3',
      '# stash 4',
      '1 M. N... 100644 100644 100644 aaa bbb src/staged only.swift',
      '1 .M N... 100644 100644 100644 aaa bbb README.md',
      '1 MM N... 100644 100644 100644 aaa bbb both.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt',
      '? thư mục/mới.txt',
      '! ignored.log',
    ];
    const status = parseStatus(enc.encode(`${records.join('\0')}\0`));

    expect(status.head).toEqual({
      kind: 'branch',
      name: 'feature/xin-chào',
      oid: '1234567890abcdef1234567890abcdef12345678',
    });
    expect(status.upstream).toBe('origin/feature/xin-chào');
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(3);
    expect(status.stashCount).toBe(4);
    expect(status.staged.map((change) => change.path)).toEqual([
      'src/staged only.swift',
      'both.txt',
      'new name.txt',
    ]);
    expect(status.staged[2]?.kind).toBe('renamed');
    expect(status.staged[2]?.oldPath).toBe('old name.txt');
    expect(status.unstaged.map((change) => change.path)).toEqual([
      'README.md',
      'both.txt',
      'thư mục/mới.txt',
    ]);
    expect(status.unstaged[2]?.kind).toBe('untracked');
    expect(status.conflicts).toEqual([{ path: 'conflict.txt', kind: 'bothModified' }]);
    expect(changedFileCount(status)).toBe(6);
    expect(isStatusClean(status)).toBe(false);
  });

  it('parsesDetachedAndUnbornHead', () => {
    const detached = parseStatus(enc.encode('# branch.oid abcdef1234567\0# branch.head (detached)\0'));
    expect(detached.head).toEqual({ kind: 'detached', oid: 'abcdef1234567' });
    expect(isDetachedHead(detached.head)).toBe(true);
    expect(headOid(detached.head)).toBe('abcdef1234567');
    const unborn = parseStatus(enc.encode('# branch.oid (initial)\0# branch.head main\0'));
    expect(unborn.head).toEqual({ kind: 'branch', name: 'main', oid: null });
    expect(isUnbornHead(unborn.head)).toBe(true);
    expect(headBranchName(unborn.head)).toBe('main');
    expect(parseStatus(new Uint8Array(0)).head).toEqual({ kind: 'unknown' });
  });

  it('parsesNameStatusWithRenames', () => {
    const files = parseNameStatus(
      enc.encode('M\0a.txt\0R087\0old/x.txt\0new/x.txt\0A\0b c.txt\0D\0gone.txt\0'),
    );
    expect(files).toEqual([
      { path: 'a.txt', kind: 'modified' },
      { path: 'new/x.txt', oldPath: 'old/x.txt', kind: 'renamed' },
      { path: 'b c.txt', kind: 'added' },
      { path: 'gone.txt', kind: 'deleted' },
    ]);
  });

  it('parsesRefs', () => {
    const lines = [
      ['refs/heads/main', 'aaa', '', 'origin/main', 'ahead 1, behind 2', '*', '', '1700000000'],
      ['refs/heads/old', 'bbb', '', 'origin/old', 'gone', ' ', ''],
      ['refs/remotes/origin/HEAD', 'aaa', '', '', '', ' ', 'refs/remotes/origin/main'],
      ['refs/remotes/origin/feature/x', 'ccc', '', '', '', ' ', ''],
      ['refs/tags/v1.0', 'ddd', 'eee', '', '', ' ', ''],
    ].map((fields) => fields.join(US));
    const refs = parseRefs(lines.join('\n'));
    expect(refs).toHaveLength(4);
    const [main, old, remote, tag] = refs;
    if (!main || !old || !remote || !tag) throw new Error('thiếu ref');
    expect(refName(main)).toBe('main');
    expect([main.isHead, main.ahead, main.behind]).toEqual([true, 1, 2]);
    expect(main.date).toBe(1_700_000_000);
    expect(old.date).toBeNull();
    expect(old.upstreamGone).toBe(true);
    expect(remote.kind).toBe('remoteBranch');
    expect(refRemoteName(remote)).toBe('origin');
    expect(refShortBranchName(remote)).toBe('feature/x');
    expect(tag.kind).toBe('tag');
    expect(tag.target).toBe('eee');
    expect(isAnnotatedTag(tag)).toBe(true);
    expect(isAnnotatedTag(main)).toBe(false);
  });

  it('remote có "/" trong tên (team/a): nhận đúng remote khi biết danh sách remote, khớp dài nhất khi lồng nhau', () => {
    const ref = (fullName: string) => ({ fullName, kind: 'remoteBranch' as const });
    const nested = ref('refs/remotes/team/a/feature/x');
    // Không biết danh sách remote: cắt ở "/" đầu tiên (hành vi cũ, đúng với remote thường).
    expect(refRemoteName(nested)).toBe('team');
    expect(refShortBranchName(nested)).toBe('a/feature/x');
    expect(refRemoteName(nested, ['origin', 'team/a'])).toBe('team/a');
    expect(refShortBranchName(nested, ['origin', 'team/a'])).toBe('feature/x');
    expect(refRemoteName(ref('refs/remotes/team/a/main'), ['team/a'])).toBe('team/a');
    // Cả `team` lẫn `team/a`: mỗi ref thuộc đúng MỘT remote, khớp dài nhất thắng.
    expect(refRemoteName(nested, ['team', 'team/a'])).toBe('team/a');
    expect(refRemoteName(nested, ['team/a', 'team'])).toBe('team/a');
    expect(refRemoteName(ref('refs/remotes/team/b'), ['team', 'team/a'])).toBe('team');
    expect(refShortBranchName(ref('refs/remotes/team/b'), ['team', 'team/a'])).toBe('b');
    // Chỉ khớp theo ranh giới "/" và cần có phần tên nhánh; remote thường vẫn đúng.
    expect(refRemoteName(ref('refs/remotes/teammate/x'), ['team'])).toBe('teammate');
    expect(refRemoteName(ref('refs/remotes/team/'), ['team'])).toBe('team');
    expect(refRemoteName(ref('refs/remotes/origin/main'), ['origin', 'team/a'])).toBe('origin');
    expect(refShortBranchName(ref('refs/remotes/origin/main'), ['origin', 'team/a'])).toBe('main');
    // Remote không có trong danh sách: quay về cách cắt cũ.
    expect(refRemoteName(ref('refs/remotes/ghost/main'), ['origin'])).toBe('ghost');
    // Không phải nhánh remote.
    expect(refRemoteName({ fullName: 'refs/heads/team/a/x', kind: 'localBranch' }, ['team/a'])).toBeNull();
    expect(refShortBranchName({ fullName: 'refs/heads/team/a/x', kind: 'localBranch' }, ['team/a'])).toBe(
      'team/a/x',
    );
  });

  it('parsesLogRecords', () => {
    const record1 = [
      '1111111111',
      '2222222222 3333333333',
      'An',
      'an@x.vn',
      '1700000000',
      'Cn',
      'cn@x.vn',
      '1700000100',
      'Merge: xin chào',
    ].join(US);
    const record2 = ['2222222222', '', 'B', 'b@x', '1600000000', 'B', 'b@x', '1600000000', 'Initial'].join(
      US,
    );
    const commits = parseLog(enc.encode(`${record1}\0${record2}\0`));
    expect(commits).toHaveLength(2);
    expect(commits[0]?.parents).toEqual(['2222222222', '3333333333']);
    expect(commits[0] && isMergeCommit(commits[0])).toBe(true);
    expect(commits[0]?.subject).toBe('Merge: xin chào');
    expect(commits[1]?.parents).toEqual([]);
    expect(commits[1]?.authorDate).toBe(1_600_000_000);
    expect(commits[1] && shortSha(commits[1])).toBe('2222222');
  });

  it('parsesRemotesAndProgress', () => {
    const remotes = parseRemotes(
      'origin\tgit@github.com:a/b.git (fetch)\norigin\tgit@github.com:a/b.git (push)\nup\thttps://x/y (fetch)\nup\thttps://x/z (push)\n',
    );
    expect(remotes.map((remote) => remote.name)).toEqual(['origin', 'up']);
    expect(remotes[1]?.pushUrl).toBe('https://x/z');
    expect(remotes[1]?.fetchUrl).toBe('https://x/y');
    expect(progressFraction('Receiving objects:  45% (450/1000), 1.2 MiB')).toBe(0.45);
    expect(progressFraction('Counting objects: done.')).toBeNull();
  });

  it('unquotesGitPaths', () => {
    expect(unquoteGitPath('"a\\tb\\"c"')).toBe('a\tb"c');
    expect(unquoteGitPath('"\\303\\251t\\303\\251"')).toBe('été');
    expect(unquoteGitPath('plain.txt')).toBe('plain.txt');
  });

  it('parsesStashMessages', () => {
    const wip: Stash = {
      index: 0,
      selector: 'stash@{0}',
      sha: 'x',
      parents: [],
      date: 0,
      message: 'WIP on main: abc1234 Sửa lỗi đăng nhập',
    };
    expect(stashDisplayMessage(wip)).toBe('WIP trên main: Sửa lỗi đăng nhập');
    expect(stashBranchName(wip)).toBe('main');
    const custom: Stash = {
      index: 1,
      selector: 'stash@{1}',
      sha: 'y',
      parents: [],
      date: 0,
      message: 'On dev: tạm cất',
    };
    expect(stashDisplayMessage(custom)).toBe('tạm cất');
    expect(stashBranchName(custom)).toBe('dev');
  });

  it('defaultCloneDirectoryNames', () => {
    expect(defaultCloneDirectoryName('https://github.com/apple/swift.git')).toBe('swift');
    expect(defaultCloneDirectoryName('git@github.com:me/du-an.git')).toBe('du-an');
    expect(defaultCloneDirectoryName('https://gitlab.com/a/b/')).toBe('b');
  });

  it('classifiesGitDirectoryChanges', () => {
    expect(classifyGitPath('objects/ab/cdef')).toEqual([]);
    expect(classifyGitPath('index.lock')).toEqual([]);
    expect(classifyGitPath('index')).toEqual(['workingTree']);
    expect(classifyGitPath('refs/heads/main')).toEqual(['refs', 'workingTree']);
    expect(classifyGitPath('HEAD')).toEqual(['refs', 'workingTree']);
    expect(classifyGitPath('MERGE_HEAD')).toEqual(['refs', 'workingTree']);
  });
});

describe('Parsers: ca biên', () => {
  it('parseLog bỏ qua bản ghi hỏng, chịu "\\n" đầu bản ghi và dấu \\x1f trong subject', () => {
    const good = [
      'aaaaaaaaaa',
      'bbbbbbbbbb',
      'A',
      'a@x',
      '10',
      'A',
      'a@x',
      '20',
      `tiêu đề${US}có dấu tách`,
    ].join(US);
    const shortSha = ['abc', '', 'A', 'a@x', '10', 'A', 'a@x', '20', 'sha ngắn'].join(US);
    const missingFields = ['cccccccccc', '', 'A'].join(US);
    const commits = parseLog(
      enc.encode(`${good}\0\n${shortSha}\0${missingFields}\0\n${good.replace('aaaaaaaaaa', 'dddddddddd')}\0`),
    );
    expect(commits.map((commit) => commit.id)).toEqual(['aaaaaaaaaa', 'dddddddddd']);
    expect(commits[0]?.subject).toBe(`tiêu đề${US}có dấu tách`);
  });

  it('parseLog: ngày không phải số → 0; UTF-8 sai → U+FFFD (lossy như Swift)', () => {
    const bytes = Uint8Array.from([
      ...enc.encode(['aaaaaaaaaa', '', 'A', 'a@x', 'abc', 'A', 'a@x', '', 'tên '].join(US)),
      0xff,
      0,
    ]);
    const [commit] = parseLog(bytes);
    expect(commit?.authorDate).toBe(0);
    expect(commit?.commitDate).toBe(0);
    expect(commit?.subject).toBe('tên \uFFFD');
  });

  it('parseStatus: bản ghi hỏng bị bỏ qua, rename thiếu đường dẫn gốc không làm lệch bản ghi sau', () => {
    const status = parseStatus(
      enc.encode(
        [
          '1 M. N... 100644 100644 100644 aaa bbb',
          '1 M. N... 100644 100644 100644 aaa bbb ok.txt',
          '1 MM N... 100644 100644 100644 aaa bbb hai.txt',
          '2 C. N... 100644 100644 100644 aaa bbb C75 copy.txt',
          'orig.txt',
          '? sau.txt',
          '',
        ].join('\0'),
      ),
    );
    expect(status.staged).toEqual([
      { path: 'ok.txt', kind: 'modified' },
      { path: 'hai.txt', kind: 'modified' },
      { path: 'copy.txt', oldPath: 'orig.txt', kind: 'copied' },
    ]);
    expect(status.unstaged).toEqual([
      { path: 'hai.txt', kind: 'modified' },
      { path: 'sau.txt', kind: 'untracked' },
    ]);
  });

  it('parseStatus: các kiểu xung đột và loại thay đổi lạ', () => {
    const kinds = ['UU', 'AA', 'DU', 'UD', 'AU', 'UA', 'DD'];
    const records = kinds.map(
      (xy, index) => `u ${xy} N... 100644 100644 100644 100644 a b c file${index}.txt`,
    );
    const status = parseStatus(enc.encode(`${records.join('\0')}\0`));
    expect(status.conflicts.map((entry) => entry.kind)).toEqual([
      'bothModified',
      'bothAdded',
      'deletedByUs',
      'deletedByThem',
      'addedByUs',
      'addedByThem',
      'bothDeleted',
    ]);
    expect(conflictHasMarkers('bothModified')).toBe(true);
    expect(conflictHasMarkers('deletedByUs')).toBe(false);
    expect(conflictDescription('unknown')).toBe('Xung đột');
    const typed = parseStatus(enc.encode('1 T. N... 120000 100644 100644 a b link\0'));
    expect(typed.staged[0]?.kind).toBe('typeChanged');
  });

  it('parseStashList đọc selector, cha và tin nhắn; chịu "\\n" đầu bản ghi', () => {
    const first = ['stash@{0}', 'aaa', 'p1 p2 p3', '1700000000', 'On main: một'].join(US);
    const second = ['stash@{1}', 'bbb', 'p1', '1600000000', 'WIP on dev: abc1234 hai'].join(US);
    const stashes = parseStashList(enc.encode(`${first}\0\n${second}\0`));
    expect(stashes.map((stash) => stash.index)).toEqual([0, 1]);
    expect(stashes[0]?.parents).toEqual(['p1', 'p2', 'p3']);
    expect(stashes[1]?.date).toBe(1_600_000_000);
    expect(stashes[1] && stashDisplayMessage(stashes[1])).toBe('WIP trên dev: hai');
  });

  it('stashDisplayMessage / stashBranchName với tin nhắn lạ', () => {
    const make = (message: string): Stash => ({
      index: 0,
      selector: 'stash@{0}',
      sha: 'x',
      parents: [],
      date: 0,
      message,
    });
    expect(stashDisplayMessage(make('không có dấu hai chấm'))).toBe('không có dấu hai chấm');
    expect(stashDisplayMessage(make('WIP on main: tiêu đề không có sha'))).toBe(
      'WIP trên main: tiêu đề không có sha',
    );
    expect(stashDisplayMessage(make('On x: a: b'))).toBe('a: b');
    expect(stashBranchName(make('tự đặt tên'))).toBeNull();
    expect(stashBranchName(make(''))).toBeNull();
  });

  it('parseRemotes: remote chỉ có fetch hoặc chỉ có push, URL chứa khoảng trắng', () => {
    const remotes = parseRemotes('a\t/tmp/a b (fetch)\nb\thttps://b/x (push)\n\nrác không có tab\n');
    expect(remotes).toEqual([
      { name: 'a', fetchUrl: '/tmp/a b', pushUrl: '/tmp/a b' },
      { name: 'b', fetchUrl: 'https://b/x', pushUrl: 'https://b/x' },
    ]);
  });

  it('parseRefs: bỏ ref ngoài heads/remotes/tags và dòng thiếu trường', () => {
    const lines = [
      ['refs/stash', 'a', '', '', '', ' ', ''].join(US),
      ['refs/heads/ok', 'b', '', '', '', ' ', ''].join(US),
      ['refs/heads/thieu', 'b'].join(US),
    ];
    expect(parseRefs(lines.join('\n')).map((ref) => ref.fullName)).toEqual(['refs/heads/ok']);
    expect(parseRefs(enc.encode(lines[1] ?? '')).map((ref) => ref.fullName)).toEqual(['refs/heads/ok']);
  });

  it('progressFraction chặn trong 0...1 và bỏ qua dòng không có số', () => {
    expect(progressFraction('Resolving deltas: 100% (5/5), done.')).toBe(1);
    expect(progressFraction('x 0% y')).toBe(0);
    expect(progressFraction('% không có số')).toBeNull();
    expect(progressFraction('')).toBeNull();
  });

  it('unquoteGitPath: escape đặc biệt, octal, dấu gạch chéo ngược cuối chuỗi, byte sai', () => {
    expect(unquoteGitPath('"a\\\\b"')).toBe('a\\b');
    expect(unquoteGitPath('"\\a\\b\\f\\v\\r"')).toBe('\u0007\b\f\v\r');
    expect(unquoteGitPath('"\\344\\275\\240"')).toBe('你');
    expect(unquoteGitPath('"tail\\\\"')).toBe('tail\\');
    expect(unquoteGitPath('"\\377"')).toBe('\uFFFD');
    expect(unquoteGitPath('"')).toBe('"');
    expect(unquoteGitPath('""')).toBe('');
    expect(unquoteGitPath('"a\\qb"')).toBe('aqb');
  });

  it('defaultCloneDirectoryName không cho ra tên nguy hiểm', () => {
    expect(defaultCloneDirectoryName('https://x.com/a/..')).toBe('repo');
    expect(defaultCloneDirectoryName('https://x.com/a/.')).toBe('repo');
    expect(defaultCloneDirectoryName('')).toBe('repo');
    expect(defaultCloneDirectoryName('  https://x.com/a/b.git  ')).toBe('b');
    expect(defaultCloneDirectoryName('https://x.com/a/b|c')).toBe('b-c');
  });

  it('hàm trợ giúp của mô hình', () => {
    expect(fileChangeName({ path: 'a/b/c.txt' })).toBe('c.txt');
    expect(fileChangeDirectory({ path: 'a/b/c.txt' })).toBe('a/b');
    expect(fileChangeDirectory({ path: 'c.txt' })).toBe('');
    expect(fileChangeAllPaths({ path: 'new', oldPath: 'old' })).toEqual(['old', 'new']);
    expect(fileChangeAllPaths({ path: 'same', oldPath: 'same' })).toEqual(['same']);
    expect(commitBody('Tóm tắt\n\nChi tiết\nthêm\n')).toBe('Chi tiết\nthêm');
    expect(commitBody('Chỉ một dòng')).toBe('');
    expect(commitSummary('  Tóm tắt\nthân')).toBe('Tóm tắt');
    expect(commitSummary('', 'dự phòng')).toBe('dự phòng');
    const wip = workingTreeCommit('abc', 5);
    expect(isWorkingTreeCommit(wip)).toBe(true);
    expect(wip.parents).toEqual(['abc']);
    expect(workingTreeCommit(null).parents).toEqual([]);
    expect(operationTitle({ kind: 'rebasing', step: 2, total: 5, headName: null })).toBe('Đang rebase (2/5)');
    expect(operationTitle({ kind: 'rebasing', step: null, total: null, headName: null })).toBe('Đang rebase');
    expect(operationShortName({ kind: 'cherryPicking' })).toBe('cherry-pick');
    expect(operationCanContinue({ kind: 'bisecting' })).toBe(false);
    expect(operationCanContinue({ kind: 'merging' })).toBe(true);
    expect(operationCanSkip({ kind: 'merging' })).toBe(false);
    expect(operationCanSkip({ kind: 'applyingPatches' })).toBe(true);
  });
});
