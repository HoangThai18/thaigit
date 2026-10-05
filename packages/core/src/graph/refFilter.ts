// Ẩn / "chỉ hiện" (solo) nhánh trên graph (port GraphRefFilter.swift): chọn điểm bắt đầu cho `git log` thay cho
// `--branches --remotes --tags HEAD`. Tên ref là tên đầy đủ (`refs/heads/x`, `refs/remotes/origin/x`).

export interface GraphRefFilter {
  readonly hidden: readonly string[];
  /** Khác rỗng: graph chỉ gồm lịch sử của các ref này (và HEAD). */
  readonly solo: readonly string[];
}

export const NO_REF_FILTER: GraphRefFilter = { hidden: [], solo: [] };

export function refFilterActive(filter: GraphRefFilter): boolean {
  return filter.hidden.length > 0 || filter.solo.length > 0;
}

/** Ref có được vẽ (nhãn, lịch sử riêng) trên graph không. */
export function refVisible(filter: GraphRefFilter, fullName: string): boolean {
  if (filter.solo.length > 0) return filter.solo.includes(fullName);
  return !filter.hidden.includes(fullName);
}

/** Bỏ các ref không còn tồn tại (nhánh đã xoá). */
export function keepingRefs(filter: GraphRefFilter, existing: ReadonlySet<string>): GraphRefFilter {
  return {
    hidden: filter.hidden.filter((name) => existing.has(name)),
    solo: filter.solo.filter((name) => existing.has(name)),
  };
}

/** Git coi mẫu của `--exclude` là glob: thoát `* ? [ ] \`. */
export function escapeGlob(text: string): string {
  return text.replace(/[*?[\]\\]/g, (char) => `\\${char}`);
}

function excludes(filter: GraphRefFilter, prefix: string): string[] {
  return filter.hidden
    .filter((name) => name.startsWith(prefix))
    .sort()
    .map((name) => `--exclude=${escapeGlob(name.slice(prefix.length))}`);
}

/**
 * Đối số chọn điểm bắt đầu cho `git log`:
 * - solo: đúng các ref đó, kèm HEAD (nhánh đang checkout và dòng WIP luôn hiện);
 * - ẩn: `--exclude=<mẫu>` ngay trước `--branches` / `--remotes` / `--tags`.
 */
export function refFilterRevisionArgs(
  filter: GraphRefFilter,
  options: { includeHead: boolean; includeRemotes: boolean; includeTags: boolean },
): string[] {
  if (filter.solo.length > 0) {
    const args = filter.solo.filter((name) => name.startsWith('refs/')).sort();
    if (options.includeHead) args.push('HEAD');
    return args;
  }
  const args = [...excludes(filter, 'refs/heads/'), '--branches'];
  if (options.includeRemotes) args.push(...excludes(filter, 'refs/remotes/'), '--remotes');
  if (options.includeTags) args.push(...excludes(filter, 'refs/tags/'), '--tags');
  if (options.includeHead) args.push('HEAD');
  return args;
}
