// Hộp thoại xác nhận dùng chung (như `Confirmation` của app Swift): một hộp tại một thời điểm, trả kết quả qua Promise.
// Chỉ hiển thị chữ thường (không HTML) — nội dung có thể chứa tên nhánh / tên file do repo đặt.

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

interface Pending extends ConfirmRequest {
  readonly id: number;
  readonly resolve: (result: ConfirmResult) => void;
}

export class DialogStore {
  current = $state.raw<Pending | null>(null);
  private serial = 0;

  /** Hiện hộp xác nhận; hộp đang mở (nếu có) bị đóng như bấm Huỷ. */
  ask(request: ConfirmRequest): Promise<ConfirmResult> {
    this.current?.resolve('cancel');
    return new Promise((resolve) => {
      this.current = { ...request, id: ++this.serial, resolve };
    });
  }

  /** Như `ask` nhưng chỉ cần biết có bấm nút chính không. */
  async confirm(request: ConfirmRequest): Promise<boolean> {
    return (await this.ask(request)) === 'confirm';
  }

  answer(result: ConfirmResult): void {
    const pending = this.current;
    if (!pending) return;
    this.current = null;
    pending.resolve(result);
  }
}

export const dialogs = new DialogStore();
