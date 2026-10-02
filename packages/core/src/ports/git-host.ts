/** Thao tác git chưa gắn với repo nào. `destination` là đường dẫn (Node) hoặc mã thư mục do dialog native trả về (Tauri). */
export interface GitHost {
  /** Ví dụ "git version 2.54.0". */
  version(): Promise<string>;
  init(destination: string): Promise<void>;
  clone(
    url: string,
    destination: string,
    options?: { onProgress?: (line: string) => void; signal?: AbortSignal },
  ): Promise<void>;
}
