// Hình dạng dữ liệu Rust trả về mà `@thaigit/contracts` chưa mô tả (serde camelCase). Giữ khớp với `src-tauri/src`.

/** Thư mục do hộp thoại native chọn: chỉ có `token` là thứ Rust chấp nhận lại; `path` chỉ để hiển thị. */
export interface PickedFolder {
  token: string;
  name: string;
  path: string;
}

/** Nguồn mở repo: token từ hộp thoại/"Mở bằng"/thả file native, hoặc id trong danh sách gần đây do Rust lưu. */
export type OpenSource = { kind: 'picked'; token: string } | { kind: 'recent'; id: string };

export interface RecentRepo {
  id: string;
  name: string;
  /** Chỉ để hiển thị. */
  path: string;
  /** Mili giây kể từ epoch. */
  lastOpened: number;
}

export interface LockFile {
  /** Đường dẫn tuyệt đối theo kiểu của hệ điều hành — cũng là định danh để gỡ (`removeStaleLock`). */
  path: string;
  /** Tương đối so với thư mục git chứa khoá (`index.lock`, `refs/heads/main.lock`), luôn dùng `/` (cả trên Windows). */
  relativePath: string;
  ageSecs: number;
}

export type RepoOperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am' | 'bisect';

export interface RepoHealth {
  /** Khoá nghi mồ côi; rỗng khi app còn lệnh git chạy trên repo (`busy`). */
  staleLocks: LockFile[];
  operation: RepoOperationKind | null;
  busy: boolean;
}

export interface GitInfo {
  path: string;
  /** Nguyên văn `git --version`. */
  version: string;
  versionTuple: [number, number, number];
  source: 'setting' | 'path' | 'fallback' | 'where';
  /** Dưới 2.35: thiếu tính năng cần dùng, mọi lệnh bị từ chối. */
  tooOld: boolean;
  /** Dưới sàn bảo mật: clone/fetch/pull bị chặn. */
  belowSecurityFloor: boolean;
  minimumVersion: string | null;
  warning: string | null;
  loginShellPathLoaded: boolean;
  /** Các git Rust tìm thấy — `setGitPath` chỉ nhận một trong số này. */
  candidates: string[];
}

export type ConfigScope = 'local' | 'global';
