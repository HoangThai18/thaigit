/**
 * Cờ rủi ro của thay đổi chưa commit (xoá / bỏ qua test, đổi thư viện, CI, file lớn, bí mật) — tính lại sau mỗi lần làm mới
 * trạng thái (gom các lần sát nhau), vì agent có thể thêm một dòng token vào file vốn đã "sửa" mà danh sách file không đổi.
 * Chỉ là gợi ý: lỗi khi tính thì giữ im lặng, không bao giờ chặn commit.
 */
import {
  collectRiskInputs,
  detectRisks,
  type GitRepository,
  type RiskFlag,
  type WorkingTreeStatus,
} from '@thaigit/core';
import { jsonEqual } from '../stores/equality.ts';

export interface RiskHost {
  readonly git: GitRepository;
  readonly status: WorkingTreeStatus;
}

export const RISK_DEBOUNCE_MS = 1500;

export class RiskStore {
  flags = $state.raw<readonly RiskFlag[]>([]);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private disposed = false;

  constructor(
    private readonly host: RiskHost,
    private readonly delayMs = RISK_DEBOUNCE_MS,
  ) {}

  /** Trạng thái vừa làm mới: tính lại sau một nhịp. */
  schedule(): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), this.delayMs);
  }

  async refresh(): Promise<void> {
    const token = ++this.token;
    try {
      const flags = detectRisks(await collectRiskInputs(this.host.git, this.host.status));
      if (token !== this.token || this.disposed) return;
      if (!jsonEqual(flags, this.flags)) this.flags = flags;
    } catch {
      // Cờ chỉ là gợi ý: repo bận / lệnh lỗi thì giữ kết quả cũ, lần làm mới sau tính lại.
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
