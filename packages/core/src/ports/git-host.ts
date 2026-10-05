/** Git operations not tied to a repository. `destination` is a path (Node) or a folder token returned by the native dialog (Tauri). */
export interface GitHost {
  /** e.g. "git version 2.54.0". */
  version(): Promise<string>;
  init(destination: string): Promise<void>;
  clone(
    url: string,
    destination: string,
    options?: { onProgress?: (line: string) => void; signal?: AbortSignal },
  ): Promise<void>;
}
