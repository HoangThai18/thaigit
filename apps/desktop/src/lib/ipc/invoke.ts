import { type InvokeArgs, type InvokeOptions, invoke } from '@tauri-apps/api/core';
import { toCommandFailure } from './errors.ts';

/** `invoke` wrapper whose errors are always `CommandFailure`. The only door from the webview into Rust. */
export async function call<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try {
    return await invoke<T>(command, args, options);
  } catch (error) {
    throw toCommandFailure(error);
  }
}
