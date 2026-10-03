// Hộp thoại dùng chung (như `Confirmation` / các sheet nhỏ của app Swift): một hộp tại một thời điểm, trả kết quả qua Promise.
// Hai loại: xác nhận (nút chính / nút phụ / Huỷ) và form ngắn (ô chữ, danh sách chọn, ô đánh dấu — đặt tên nhánh, push lên
// remote…). Chỉ hiển thị chữ thường (không HTML) — nội dung có thể chứa tên nhánh / tên file do repo đặt.

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmTitle: string;
  /** Nút xác nhận màu đỏ (xoá, huỷ thay đổi, force push…). */
  destructive?: boolean;
  /** Nút thứ hai giữa nút xác nhận và "Huỷ" (ví dụ "Revert, chưa commit"). */
  secondaryTitle?: string;
}

/** Kết quả: 'confirm' (nút chính), 'secondary' (nút thứ hai), 'cancel' (Huỷ / Esc / bấm ra ngoài). */
export type ConfirmResult = 'confirm' | 'secondary' | 'cancel';

export type FormField =
  | {
      readonly kind: 'text';
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly placeholder?: string;
      /** Chữ đơn cách (tên nhánh, SHA…). */
      readonly monospace?: boolean;
    }
  | {
      readonly kind: 'select';
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | { readonly kind: 'checkbox'; readonly id: string; readonly label: string; readonly value: boolean };

export type FormValues = Readonly<Record<string, string | boolean>>;

export interface FormRequest {
  title: string;
  message?: string;
  fields: readonly FormField[];
  confirmTitle: string;
  destructive?: boolean;
  /** Lỗi hiện dưới form (`null` = hợp lệ); còn lỗi thì nút chính tắt. Chạy lại mỗi lần sửa ô nên phải nhanh, không gọi git. */
  validate?: (values: FormValues) => string | null;
}

export type PendingDialog =
  | (ConfirmRequest & { readonly kind: 'confirm'; readonly id: number; readonly resolve: (result: ConfirmResult) => void })
  | (FormRequest & { readonly kind: 'form'; readonly id: number; readonly resolve: (values: FormValues | null) => void });

/** Giá trị chữ của một ô form (đã bỏ khoảng trắng hai đầu). */
export function textValue(values: FormValues, id: string): string {
  const value = values[id];
  return typeof value === 'string' ? value.trim() : '';
}

export function flagValue(values: FormValues, id: string): boolean {
  return values[id] === true;
}

export class DialogStore {
  current = $state.raw<PendingDialog | null>(null);
  private serial = 0;

  /** Hiện hộp xác nhận; hộp đang mở (nếu có) bị đóng như bấm Huỷ. */
  ask(request: ConfirmRequest): Promise<ConfirmResult> {
    this.dismiss();
    return new Promise((resolve) => {
      this.current = { ...request, kind: 'confirm', id: ++this.serial, resolve };
    });
  }

  /** Như `ask` nhưng chỉ cần biết có bấm nút chính không. */
  async confirm(request: ConfirmRequest): Promise<boolean> {
    return (await this.ask(request)) === 'confirm';
  }

  /** Hiện form; trả giá trị các ô khi bấm nút chính, `null` khi huỷ. */
  form(request: FormRequest): Promise<FormValues | null> {
    this.dismiss();
    return new Promise((resolve) => {
      this.current = { ...request, kind: 'form', id: ++this.serial, resolve };
    });
  }

  /** Trả lời hộp xác nhận; với form thì chỉ 'cancel' có nghĩa (gửi form dùng `submit`). */
  answer(result: ConfirmResult): void {
    const pending = this.current;
    if (!pending) return;
    if (pending.kind === 'form') {
      if (result !== 'cancel') return;
      this.current = null;
      pending.resolve(null);
      return;
    }
    this.current = null;
    pending.resolve(result);
  }

  /** Gửi form đang mở (bỏ qua nếu còn lỗi kiểm tra). */
  submit(values: FormValues): void {
    const pending = this.current;
    if (!pending || pending.kind !== 'form') return;
    if (pending.validate?.(values)) return;
    this.current = null;
    pending.resolve(values);
  }

  private dismiss(): void {
    const pending = this.current;
    if (!pending) return;
    this.current = null;
    if (pending.kind === 'form') pending.resolve(null);
    else pending.resolve('cancel');
  }
}

export const dialogs = new DialogStore();
