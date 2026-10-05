/** Version string in "1.2.3" form (leading "v" stripped), compared part by part: 1.10 > 1.9, 1.1 == 1.1.0. */
export class AppVersion {
  readonly text: string;
  private readonly parts: number[];

  private constructor(text: string, parts: number[]) {
    this.text = text;
    this.parts = parts;
  }

  static parse(input: string): AppVersion | null {
    let trimmed = input.trim();
    if (trimmed.startsWith('v') || trimmed.startsWith('V')) trimmed = trimmed.slice(1);
    const pieces = trimmed.split('.');
    if (pieces.length < 1 || pieces.length > 4) return null;
    const values: number[] = [];
    for (const piece of pieces) {
      if (!/^\d{1,9}$/.test(piece)) return null;
      values.push(Number(piece));
    }
    // Drop trailing zeros so 1.1 and 1.1.0 compare equal.
    while (values.length > 1 && values[values.length - 1] === 0) values.pop();
    return new AppVersion(trimmed, values);
  }

  compare(other: AppVersion): number {
    const count = Math.max(this.parts.length, other.parts.length);
    for (let i = 0; i < count; i++) {
      const a = this.parts[i] ?? -1;
      const b = other.parts[i] ?? -1;
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  }

  toString(): string {
    return this.text;
  }
}
