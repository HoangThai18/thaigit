import { Commands } from '@thaigit/contracts';
import { call } from './invoke.ts';

/** Mở terminal tại gốc repo (macOS: Ghostty → iTerm2 → Warp → Terminal; Windows: wt.exe → PowerShell). */
export function openInTerminal(repoId: string): Promise<void> {
  return call<void>(Commands.openInTerminal, { repoId });
}

/** Mở trình soạn thảo (VS Code → Cursor → Zed → Sublime); `relativePath` phải nằm trong repo. */
export function openInEditor(repoId: string, relativePath?: string): Promise<void> {
  return call<void>(Commands.openInEditor, { repoId, path: relativePath ?? null });
}

/** Hiện trong Finder/Explorer; `relativePath` phải nằm trong repo. */
export function reveal(repoId: string, relativePath?: string): Promise<void> {
  return call<void>(Commands.reveal, { repoId, path: relativePath ?? null });
}

/**
 * Mở URL bằng ứng dụng mặc định. Rust chỉ nhận `https:` (không kèm thông tin đăng nhập); `mailto:` chỉ khi `confirmed`
 * (UI phải hỏi người dùng trước). URL lấy từ commit/AI cần hiện đầy đủ cho người dùng xem trước khi gọi.
 */
export function openUrl(url: string, confirmed = false): Promise<void> {
  return call<void>(Commands.openUrl, { url, confirmed });
}
