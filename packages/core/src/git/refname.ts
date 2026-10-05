// Validate branch/tag names right in TS (without running git) following `git check-ref-format`, so the name form can
// report errors immediately.
// `GitRepository.isValidRefName` still asks real git (the source of truth); tests compare both over one set of names.

/** Characters git forbids in ref names: ASCII control chars (< 0x20, 0x7f), whitespace, and `~ ^ : ? * [ \`. */
const FORBIDDEN_CHARACTERS = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Is the name (the part after `refs/heads/` or `refs/tags/`) valid?
 * `branch` (default) adds `git check-ref-format --branch` rules: no leading `-`, not `HEAD`.
 * Deliberately one difference from git: tags starting with `-` are rejected too (git allows them, but `git tag -x` would
 * read them as options).
 */
export function isValidRefName(name: string, branch = true): boolean {
  if (name === '' || name.startsWith('-')) return false;
  if (branch && name === 'HEAD') return false;
  if (FORBIDDEN_CHARACTERS.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.endsWith('.')) return false;
  // Each "/"-separated component: non-empty (which also drops leading/trailing "/" and "//"), no leading ".", no trailing ".lock".
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * Valid remote name: git requires `refs/remotes/<name>/x` to be a valid ref (`valid_remote_name`), i.e. the same
 * component rules as a tag name — including a ban on a leading `-` (otherwise `git remote rename a -x` reads it as an option).
 */
export function isValidRemoteName(name: string): boolean {
  return isValidRefName(name, false);
}
