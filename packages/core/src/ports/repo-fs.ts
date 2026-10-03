/**
 * Đọc/ghi file của repo theo byte, trong phạm vi repo (Rust kiểm realpath; adapter Node áp cùng luật).
 * Đường dẫn luôn tương đối với gốc working tree (hoặc git dir với `readGitFile`), dùng `/`.
 */
export interface RepoFs {
  /** MERGE_HEAD, MERGE_MSG, SQUASH_MSG, CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_LOG, rebase-merge/*, rebase-apply/*. Không có → null. */
  readGitFile(relative: string): Promise<Uint8Array | null>;
  /** Không có → null; lớn hơn `maxBytes` → lỗi. */
  readWorktreeFile(relative: string, maxBytes?: number): Promise<Uint8Array | null>;
  /** Ghi tạm + đổi tên, giữ quyền file. `expectedSha256` khác nội dung hiện tại → lỗi `conflict` (file đã đổi bên ngoài). */
  writeWorktreeFile(relative: string, bytes: Uint8Array, expectedSha256: string | null): Promise<void>;
  /** Thêm một dòng vào `.gitignore` theo byte (giữ kiểu xuống dòng, thêm xuống dòng cuối nếu thiếu). */
  appendGitignore(line: string): Promise<void>;
  /** Dời file chưa track vào thùng rác của app (`<commonDir>/thaigit/trash/<thời điểm>/`), trả token để khôi phục. */
  trashUntracked(relatives: readonly string[]): Promise<string>;
  restoreTrash(token: string): Promise<void>;
  /**
   * Tạo `<gitDir>/thaigit/` (thư mục thật) và trả đường dẫn tuyệt đối của index tạm của snapshot (`indexFile` trong
   * snapshot.json); `reset` xoá đúng index tạm và file `.lock` của nó. Repo đang có thao tác ghi → lỗi `busy`.
   */
  prepareSnapshotIndex(reset: boolean): Promise<string>;
}
