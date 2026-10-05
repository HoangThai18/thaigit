/**
 * Ảnh đại diện thật của người commit cho node graph (như GitKraken). Rust tải + cache trên đĩa rồi trả data URL
 * (`avatar_lookup`); ở đây chỉ giữ ảnh ĐÃ giải mã để canvas vẽ được. Chưa có ảnh thì node vẽ chữ viết tắt.
 *
 * Một store dùng chung cho mọi cửa sổ: cùng một email chỉ hỏi Rust một lần, và `version` tăng mỗi khi có ảnh mới
 * để lớp canvas vẽ lại đúng một lần thay vì mỗi hàng một lần.
 */
import { avatarLookup } from '../ipc/index.ts';

/** Số ảnh giữ đã giải mã trong RAM; vượt thì bỏ ảnh cũ nhất (Rust vẫn cache trên đĩa nên lần sau lấy lại rất nhanh). */
const MEMORY_LIMIT = 400;

/** Khoá bộ nhớ theo email: chuẩn hoá giống Rust (`normalize`) để cùng một người chỉ có một mục. */
export function avatarKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Cổng tải ảnh — test thay bằng hàm giả, không gọi IPC thật. */
export type AvatarPort = (email: string) => Promise<string | null>;

/** Ảnh đã giải mã: Rust chỉ trả ảnh raster nên luôn là `HTMLImageElement` (canvas vẽ bằng kích thước tự nhiên). */
export type AvatarImage = HTMLImageElement;

/** Giải mã data URL thành ảnh đã nạp. `null` khi không có `Image` (môi trường kiểm thử) hoặc ảnh hỏng. */
async function decode(dataUrl: string): Promise<AvatarImage | null> {
  if (typeof Image === 'undefined') return null;
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return null;
  }
  return image;
}

export class AvatarStore {
  /** Tăng mỗi khi có ảnh mới — lớp canvas đọc để biết khi nào vẽ lại. */
  version = $state(0);
  readonly #images = new Map<string, AvatarImage>();
  /** email không có ảnh (đã hỏi xong) — để khỏi hỏi lại cùng một người. */
  readonly #missing = new Set<string>();
  readonly #pending = new Map<string, Promise<void>>();

  constructor(private readonly port: AvatarPort = avatarLookup) {}

  /** Ảnh đã giải mã của `email`; `null` khi chưa tải xong hoặc không có ảnh. */
  image(email: string): AvatarImage | null {
    const key = avatarKey(email);
    if (!key.includes('@')) return null;
    return this.#images.get(key) ?? null;
  }

  /** Bảo đảm ảnh của `email` nằm trong bộ nhớ (tải nếu chưa có). Lỗi thì im lặng: node vẽ chữ viết tắt. */
  ensure(email: string): void {
    const key = avatarKey(email);
    if (!key.includes('@') || this.#images.has(key) || this.#missing.has(key) || this.#pending.has(key)) return;
    const pending = this.#load(key, email);
    this.#pending.set(key, pending);
    void pending.then(() => this.#pending.delete(key));
  }

  async #load(key: string, email: string): Promise<void> {
    let dataUrl: string | null = null;
    try {
      dataUrl = await this.port(email);
    } catch {
      // Không ghi "không có ảnh": lần sau còn thử lại (lỗi mạng, repo chưa tin cậy…).
      return;
    }
    if (dataUrl === null) {
      this.#missing.add(key);
      return;
    }
    const image = await decode(dataUrl);
    if (image === null) {
      this.#missing.add(key);
      return;
    }
    this.#remember(key, image);
    this.version += 1;
  }

  #remember(key: string, image: AvatarImage): void {
    this.#images.delete(key);
    this.#images.set(key, image);
    while (this.#images.size > MEMORY_LIMIT) {
      const oldest = this.#images.keys().next();
      if (oldest.done) break;
      this.#images.delete(oldest.value);
    }
  }
}

/** Store dùng chung: nhiều cửa sổ repo cùng xem một người commit không nên tải lại. */
export const avatars = new AvatarStore();
