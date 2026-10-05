// Hide branches on the graph, or restrict the graph to "solo" branches (port of GraphRefFilter.swift): picks the
// starting point for `git log` instead of `--branches --remotes --tags HEAD`. Ref names are fully qualified// (`refs/heads/x`, `refs/remotes/origin/x`).

export interface GraphRefFilter {
  readonly hidden: readonly string[];
  /** Non-empty: the graph contains only the history of these refs (plus HEAD). */
  readonly solo: readonly string[];
}

export const NO_REF_FILTER: GraphRefFilter = { hidden: [], solo: [] };

export function refFilterActive(filter: GraphRefFilter): boolean {
  return filter.hidden.length > 0 || filter.solo.length > 0;
}

/** Whether the ref is drawn on the graph (label, own history). */
export function refVisible(filter: GraphRefFilter, fullName: string): boolean {
  if (filter.solo.length > 0) return filter.solo.includes(fullName);
  return !filter.hidden.includes(fullName);
}

/** Drops refs that no longer exist (deleted branches). */
export function keepingRefs(filter: GraphRefFilter, existing: ReadonlySet<string>): GraphRefFilter {
  return {
    hidden: filter.hidden.filter((name) => existing.has(name)),
    solo: filter.solo.filter((name) => existing.has(name)),
  };
}

/** Git treats `--exclude` patterns as globs: escape `* ? [ ] \`. */
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
 * Starting-point args for `git log`:
 * - solo: exactly those refs, plus HEAD (the checked-out branch and the WIP row are always shown);
 * - hide: `--exclude=<pattern>` right before `--branches` / `--remotes` / `--tags`.
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
