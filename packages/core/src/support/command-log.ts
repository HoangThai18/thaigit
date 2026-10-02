// Nhật ký lệnh git ("Nhật ký lệnh" trong app). Credential bị che NGAY LÚC GHI: bản ghi lưu trong bộ nhớ không bao giờ
// chứa mật khẩu/token ở dạng rõ, nên cũng không thể lộ qua màn hình, ảnh chụp hay báo lỗi sau này.

const MASK = '***';

/** `scheme://userinfo@` — userinfo chạy tới `@` CUỐI trong đoạn (mật khẩu thô có thể chứa `@`); scheme ≤ 32 ký tự để quét tuyến tính. */
const URL_USERINFO = /([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/)([^\s/?#]*)@/g;

/** Với scheme SSH-like, userinfo không có `:` chỉ là tên người dùng (`ssh://git@host`) nên giữ lại; scheme khác luôn che. */
const USERNAME_ONLY_SCHEMES = new Set(['ssh://', 'git+ssh://', 'ssh+git://', 'git://']);

/** Mẫu token biết trước. Mỗi mẫu là tiền tố cố định + lớp ký tự (không lồng/không lặp mơ hồ) nên không quay lui thảm hoạ. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{8,}/g, // GitHub: ghp_ (PAT), gho_, ghu_, ghs_, ghr_
  /github_pat_[A-Za-z0-9_]{8,}/g, // GitHub fine-grained PAT
  /glpat-[A-Za-z0-9_-]{8,}/g, // GitLab PAT
  /xox[abposr]-[A-Za-z0-9-]{8,}/g, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{8,}/g, // AWS access key id
];

/** Header `Authorization: Bearer …` còn sót trong stderr/đối số. */
const AUTHORIZATION_HEADER = /(Authorization:[ \t]*)(?:Bearer|Basic|Token)[ \t]+\S+/gi;

/** Che credential trong một chuỗi (đối số lệnh hoặc stderr). Thuần, thời gian tuyến tính theo độ dài chuỗi. */
export function redactSecrets(text: string): string {
  let result = text.replace(URL_USERINFO, (whole, scheme: string, userinfo: string) =>
    !userinfo.includes(':') && USERNAME_ONLY_SCHEMES.has(scheme.toLowerCase()) ? whole : `${scheme}${MASK}@`,
  );
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, MASK);
  return result.replace(AUTHORIZATION_HEADER, `$1${MASK}`);
}

/** Một dòng nhật ký (đã che). `args` gồm cả subcommand: `["fetch", "--all"]`. */
export interface GitCommandRecord {
  readonly id: number;
  readonly args: readonly string[];
  /** Mili-giây epoch. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly cancelled: boolean;
  /** Tối đa `MAX_STDERR_CHARS` ký tự đầu (cắt SAU khi che, để token nằm ngang chỗ cắt không lọt ra nửa chừng). */
  readonly stderr: string;
}

export type RawCommandRecord = Omit<GitCommandRecord, 'id'>;

export const MAX_STDERR_CHARS = 4000;

export function commandLine(record: Pick<GitCommandRecord, 'args'>): string {
  return `git ${record.args.join(' ')}`;
}

/** Vòng đệm các lệnh git đã chạy (giữ tối đa `capacity` dòng gần nhất). */
export class CommandLog {
  private storage: GitCommandRecord[] = [];
  private nextId = 1;
  private readonly listeners = new Set<(record: GitCommandRecord) => void>();

  constructor(private readonly capacity = 400) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity phải là số nguyên ≥ 1');
  }

  /** Che credential rồi mới lưu. Trả về bản ghi đã che. */
  record(raw: RawCommandRecord): GitCommandRecord {
    const record: GitCommandRecord = Object.freeze({
      id: this.nextId++,
      args: Object.freeze(raw.args.map(redactSecrets)),
      startedAt: raw.startedAt,
      durationMs: raw.durationMs,
      exitCode: raw.exitCode,
      cancelled: raw.cancelled,
      stderr: redactSecrets(raw.stderr).slice(0, MAX_STDERR_CHARS),
    });
    // Sao chép khi ghi: mảng đã trả cho `records` không bao giờ bị sửa tiếp (ảnh chụp ổn định cho UI).
    const keep =
      this.storage.length >= this.capacity
        ? this.storage.slice(this.storage.length - this.capacity + 1)
        : this.storage;
    this.storage = [...keep, record];
    for (const listener of this.listeners) listener(record);
    return record;
  }

  /** Ảnh chụp bất biến, cũ → mới. */
  get records(): readonly GitCommandRecord[] {
    return this.storage;
  }

  clear(): void {
    this.storage = [];
  }

  /** Nhận bản ghi mới (đã che). Trả hàm huỷ đăng ký. */
  subscribe(listener: (record: GitCommandRecord) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
