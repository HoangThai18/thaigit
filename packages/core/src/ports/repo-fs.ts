/**
 * Byte-oriented reads/writes of repo files, scoped to the repository (Rust checks the realpath; the Node adapter applies
 * the same rules).
 * Paths are always relative to the working-tree root (or to the git dir for `readGitFile`) and always use `/`.
 */
export interface RepoFs {
  /** MERGE_HEAD, MERGE_MSG, SQUASH_MSG, CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_LOG, rebase-merge/*, rebase-apply/*. Missing → null. */
  readGitFile(relative: string): Promise<Uint8Array | null>;
  /** Missing → null; larger than `maxBytes` → error. */
  readWorktreeFile(relative: string, maxBytes?: number): Promise<Uint8Array | null>;
  /** Write to a temp file then rename, preserving the file mode. `expectedSha256` differing from the current content → `conflict` error (file changed externally). */
  writeWorktreeFile(relative: string, bytes: Uint8Array, expectedSha256: string | null): Promise<void>;
  /** Append a line to `.gitignore` byte-wise (preserving the line terminator style, adding a final one when missing). */
  appendGitignore(line: string): Promise<void>;
  /** Move an untracked file into the app's trash (`<commonDir>/thaigit/trash/<timestamp>/`) and return a token for restoring it. */
  trashUntracked(relatives: readonly string[]): Promise<string>;
  restoreTrash(token: string): Promise<void>;
  /**
   * Create `<gitDir>/thaigit/` (a real directory) and return the absolute path of the snapshot's temporary index
   * (`indexFile` in snapshot.json); `reset` deletes exactly that temporary index and its `.lock` file.
   * A repo with a write operation in progress → `busy` error.
   */
  prepareSnapshotIndex(reset: boolean): Promise<string>;
}
