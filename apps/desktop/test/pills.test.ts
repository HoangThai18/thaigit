import type { HeadState } from '@thaigit/core';
import { describe, expect, it } from 'vitest';
import {
  PILL,
  buildRefLabels,
  layoutPills,
  pillAppearance,
  pillIcons,
  pillTooltip,
  type RefLabel,
} from '../src/lib/graph/pills.ts';
import { local, remote, tag } from './helpers/models.ts';

const ON = { showRemotes: true, showTags: true } as const;
const branch = (name: string, oid: string | null = 'a'): HeadState => ({ kind: 'branch', name, oid });

function labelsAt(map: Map<string, RefLabel[]>, target: string): RefLabel[] {
  return map.get(target) ?? [];
}

describe('buildRefLabels', () => {
  it('gộp nhánh local với remote cùng tên/upstream thành một nhãn có biểu tượng đám mây', () => {
    const refs = [
      local('main', 'a', { upstream: 'origin/main', isHead: true }),
      remote('origin/main', 'a'),
      remote('origin/other', 'a'),
    ];
    const labels = labelsAt(buildRefLabels(refs, branch('main'), ON), 'a');
    expect(labels.map((label) => label.text)).toEqual(['main', 'other']);
    expect(labels[0]).toMatchObject({ isCurrentBranch: true, hasLocal: true, remoteCount: 1 });
    expect(labels[0]?.refs.map((ref) => ref.fullName)).toEqual([
      'refs/heads/main',
      'refs/remotes/origin/main',
    ]);
    expect(pillIcons(labels[0] as RefLabel)).toEqual(['check', 'laptop', 'cloud']);
  });

  it('gộp theo tên ngắn khi local chưa đặt upstream', () => {
    const refs = [local('feature/x', 'a'), remote('origin/feature/x', 'a')];
    const [label] = labelsAt(buildRefLabels(refs, branch('main'), ON), 'a');
    expect(label).toMatchObject({ text: 'feature/x', remoteCount: 1 });
  });

  it('remote-only: một remote → tên ngắn, nhiều remote → tên đầy đủ', () => {
    const one = buildRefLabels([remote('origin/dev', 'a')], branch('main'), ON);
    expect(labelsAt(one, 'a').map((label) => label.text)).toEqual(['dev']);
    const two = buildRefLabels([remote('origin/dev', 'a'), remote('up/dev', 'b')], branch('main'), ON);
    expect(labelsAt(two, 'a').map((label) => label.text)).toEqual(['origin/dev']);
  });

  it('remote có "/" trong tên (team/a): nhãn là "main" (không phải "a/main") và vẫn gộp với nhánh local cùng tên', () => {
    const refs = [local('main', 'a'), remote('team/a/main', 'a'), remote('team/a/dev', 'b')];
    const labels = buildRefLabels(refs, branch('main'), { ...ON, remoteNames: ['team/a'] });
    expect(labelsAt(labels, 'a').map((label) => label.text)).toEqual(['main']);
    expect(labelsAt(labels, 'a')[0]).toMatchObject({ hasLocal: true, remoteCount: 1 });
    expect(labelsAt(labels, 'b').map((label) => label.text)).toEqual(['dev']);
    // Hai remote (một cái có "/"): nhãn remote-only dùng tên đầy đủ.
    const two = buildRefLabels([remote('team/a/dev', 'b'), remote('origin/dev', 'c')], branch('x'), {
      ...ON,
      remoteNames: ['origin', 'team/a'],
    });
    expect(labelsAt(two, 'b').map((label) => label.text)).toEqual(['team/a/dev']);
  });

  it('thứ tự: nhánh hiện tại, local, remote, tag', () => {
    const refs = [tag('v1', 'a'), remote('origin/z', 'a'), local('b', 'a'), local('a-current', 'a')];
    const labels = labelsAt(buildRefLabels(refs, branch('a-current'), ON), 'a');
    expect(labels.map((label) => label.text)).toEqual(['a-current', 'b', 'z', 'v1']);
  });

  it('ẩn remote/tag theo tuỳ chọn nhưng local vẫn gộp remote đã khớp', () => {
    const refs = [
      local('main', 'a', { upstream: 'origin/main' }),
      remote('origin/main', 'a'),
      remote('origin/x', 'a'),
      tag('v1', 'a'),
    ];
    const labels = labelsAt(
      buildRefLabels(refs, branch('main'), { showRemotes: false, showTags: false }),
      'a',
    );
    expect(labels.map((label) => label.text)).toEqual(['main']);
    expect(labels[0]?.remoteCount).toBe(1);
  });

  it('HEAD tách rời: nhãn HEAD đứng đầu commit đang trỏ tới', () => {
    const refs = [tag('v1', 'a')];
    const labels = labelsAt(buildRefLabels(refs, { kind: 'detached', oid: 'a' }, ON), 'a');
    expect(labels.map((label) => label.text)).toEqual(['HEAD', 'v1']);
    expect(labels[0]?.isDetachedHead).toBe(true);
    expect(pillIcons(labels[0] as RefLabel)).toEqual(['warning']);
    expect(pillTooltip(labels[0] as RefLabel)).toBe('HEAD (tách rời)');
  });

  it('commit không có nhãn thì không có khoá', () => {
    expect(buildRefLabels([local('main', 'a')], branch('main'), ON).has('b')).toBe(false);
  });

  it('tooltip liệt kê từng ref kèm upstream', () => {
    const [label] = labelsAt(
      buildRefLabels(
        [local('main', 'a', { upstream: 'origin/main' }), remote('origin/main', 'a')],
        branch('main'),
        ON,
      ),
      'a',
    );
    expect(pillTooltip(label as RefLabel)).toBe('Nhánh local: main → origin/main\nNhánh remote: origin/main');
  });
});

describe('layoutPills', () => {
  const measure = (text: string): number => text.length * 6;
  const label = (text: string): RefLabel => ({
    key: text,
    text,
    isCurrentBranch: false,
    hasLocal: true,
    remoteCount: 0,
    isTag: false,
    isDetachedHead: false,
    refs: [],
  });

  it('đủ chỗ: xếp lần lượt, cách nhau 4px, không có +N', () => {
    const layout = layoutPills([label('main'), label('dev')], 400, measure);
    expect(layout.more).toBeNull();
    // 7 + icon laptop (13) + 24 + 7
    expect(layout.pills[0]).toEqual({ index: 0, x: 6, width: 7 + 13 + 24 + 7 });
    expect(layout.pills[1]?.x).toBe(6 + 51 + PILL.gap);
    expect(layout.end).toBe((layout.pills[1]?.x ?? 0) + (layout.pills[1]?.width ?? 0));
  });

  it('tràn: chừa chỗ cho "+N" và đếm đúng số nhãn bị gộp', () => {
    const labels = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'].map(label);
    const layout = layoutPills(labels, 190, measure);
    expect(layout.more).not.toBeNull();
    expect(layout.pills.length + (layout.more?.count ?? 0)).toBe(labels.length);
    // Các viên đã xếp không chạm chip "+N".
    const last = layout.pills[layout.pills.length - 1];
    expect((last?.x ?? 0) + (last?.width ?? 0) + PILL.gap).toBeLessThanOrEqual(layout.more?.x ?? 0);
    expect(layout.end).toBe((layout.more?.x ?? 0) + PILL.moreWidth);
  });

  it('ô quá hẹp: không viên nào, chỉ "+N" ở đầu ô', () => {
    const layout = layoutPills([label('main'), label('dev')], 40, measure);
    expect(layout.pills).toEqual([]);
    expect(layout.more).toEqual({ x: PILL.startX, count: 2 });
  });

  it('viên cuối co lại để vừa ô (không có nhãn phía sau thì không chừa chỗ cho +N)', () => {
    const layout = layoutPills([label('x'.repeat(40))], 150, measure);
    expect(layout.more).toBeNull();
    expect(layout.pills[0]?.width).toBe(150 - PILL.rightPadding - PILL.startX);
  });

  it('không có nhãn: không viên nào', () => {
    expect(layoutPills([], 200, measure)).toEqual({ pills: [], more: null, end: PILL.startX });
  });
});

describe('pillAppearance', () => {
  const base: RefLabel = {
    key: 'k',
    text: 'main',
    isCurrentBranch: false,
    hasLocal: true,
    remoteCount: 0,
    isTag: false,
    isDetachedHead: false,
    refs: [],
  };

  it('nhánh hiện tại: đậm hơn và viền sáng hơn', () => {
    const current = pillAppearance({ ...base, isCurrentBranch: true }, '#2f86e8');
    const other = pillAppearance(base, '#2f86e8');
    expect(current.rimWidth).toBeGreaterThan(other.rimWidth);
    expect(current.top).not.toContain('/'); // không trong suốt
    expect(other.top).toContain('/ 0.88');
  });

  it('remote-only nhạt hơn local cùng màu làn; mờ đi khi bị loại khỏi kết quả tìm', () => {
    const remoteOnly = pillAppearance({ ...base, hasLocal: false, remoteCount: 1 }, '#f05032');
    const localLabel = pillAppearance(base, '#f05032');
    expect(remoteOnly.top).not.toBe(localLabel.top);
    expect(pillAppearance(base, '#f05032', true).top).toContain('/ 0.308');
  });
});
