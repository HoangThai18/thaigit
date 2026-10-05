// READ-ONLY admin page: its own listener on 127.0.0.1 (never exposed to the Internet → no web login or CSRF needed).
// Reach it through an SSH tunnel: `ssh -L 8788:127.0.0.1:8788 <vps>` then open http://127.0.0.1:8788.
// The HTML is built with Hono's `html` helper, which escapes every interpolated value.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { Db } from './db.ts';
import { dayMinus, vnDay } from './time.ts';

type Row = Record<string, string | number | null>;

function rows(db: Db, sql: string, ...params: (string | number)[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function table(title: string, columns: string[], data: Row[]) {
  const max = Math.max(1, ...data.map((row) => Number(row[columns[columns.length - 1] ?? ''] ?? 0)));
  return html`<section>
    <h2>${title}</h2>
    ${
      data.length === 0
        ? html`<p class="empty">Chưa có dữ liệu.</p>`
        : html`<table>
            <thead>
              <tr>
                ${columns.map((column) => html`<th>${column}</th>`)}
              </tr>
            </thead>
            <tbody>
              ${data.map(
                (row) =>
                  html`<tr>
                    ${columns.map((column, index) =>
                      index === columns.length - 1 && typeof row[column] === 'number'
                        ? html`<td class="num">
                            <span
                              class="bar"
                              style="width:${Math.round((Number(row[column]) / max) * 100)}%"
                            ></span
                            >${row[column]}
                          </td>`
                        : html`<td>${row[column] ?? '—'}</td>`,
                    )}
                  </tr>`,
              )}
            </tbody>
          </table>`
    }
  </section>`;
}

export function createAdminApp(db: Db, now: () => number = Date.now): Hono {
  const app = new Hono();
  app.get('/', (c) => {
    const today = vnDay(now());
    const since30 = dayMinus(today, 29);
    const active = (days: number) =>
      (
        db
          .prepare(`SELECT COUNT(DISTINCT tel_hash) AS n FROM daily_active WHERE day >= ?`)
          .get(dayMinus(today, days - 1)) as { n: number }
      ).n;
    const summary = [
      { 'Chỉ số': 'Người dùng hôm nay (DAU)', 'Giá trị': active(1) },
      { 'Chỉ số': '7 ngày (WAU)', 'Giá trị': active(7) },
      { 'Chỉ số': '30 ngày (MAU)', 'Giá trị': active(30) },
    ];
    const downloads = rows(
      db,
      `SELECT day AS "Ngày",
              SUM(asset = 'mac') AS "macOS", SUM(asset = 'win') AS "Windows", COUNT(*) AS "Tổng"
       FROM downloads WHERE day >= ? GROUP BY day ORDER BY day DESC`,
      since30,
    );
    const versions = rows(
      db,
      `SELECT platform AS "Nền tảng", app_version AS "Phiên bản", COUNT(*) AS "Máy (7 ngày)"
       FROM (SELECT DISTINCT tel_hash, platform, app_version FROM daily_active WHERE day >= ?)
       GROUP BY platform, app_version ORDER BY 3 DESC`,
      dayMinus(today, 6),
    );
    const dau = rows(
      db,
      `SELECT day AS "Ngày", platform AS "Nền tảng", SUM(dau) AS "DAU"
       FROM daily_counts WHERE day >= ? GROUP BY day, platform ORDER BY day DESC, platform`,
      since30,
    );
    const ai = rows(
      db,
      `SELECT day AS "Ngày", feature AS "Tính năng",
              SUM(status = 'ok') AS "Thành công", SUM(status = 'error') AS "Lỗi", SUM(status = 'cancelled') AS "Huỷ",
              SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) AS "Token",
              CAST(AVG(queue_ms) AS INTEGER) AS "Chờ TB (ms)", CAST(AVG(ttft_ms) AS INTEGER) AS "Chữ đầu TB (ms)",
              COUNT(*) AS "Tổng"
       FROM ai_requests WHERE day >= ? GROUP BY day, feature ORDER BY day DESC, feature`,
      since30,
    );
    const errors = rows(
      db,
      `SELECT error_code AS "Mã lỗi", COUNT(*) AS "Số lần (30 ngày)"
       FROM ai_requests WHERE error_code IS NOT NULL GROUP BY error_code ORDER BY 2 DESC`,
    );
    return c.html(
      html`<!doctype html>
        <html lang="vi">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Thaigit · Admin</title>
            <style>
              body {
                font:
                  14px/1.5 system-ui,
                  sans-serif;
                margin: 24px;
                color: #1d1d1f;
                background: #f5f5f7;
              }
              h1 {
                font-size: 20px;
              }
              h2 {
                font-size: 15px;
                margin: 24px 0 8px;
              }
              section {
                background: #fff;
                border-radius: 12px;
                padding: 4px 16px 12px;
                margin-bottom: 16px;
              }
              table {
                border-collapse: collapse;
                width: 100%;
              }
              th,
              td {
                text-align: left;
                padding: 4px 8px;
              }
              th {
                color: #6e6e73;
                font-weight: 600;
                border-bottom: 1px solid #e5e5ea;
              }
              td.num {
                position: relative;
                font-variant-numeric: tabular-nums;
              }
              .bar {
                position: absolute;
                left: 0;
                top: 4px;
                bottom: 4px;
                background: #0a84ff22;
                border-radius: 4px;
              }
              .empty {
                color: #6e6e73;
              }
              .note {
                color: #6e6e73;
                font-size: 12px;
              }
            </style>
          </head>
          <body>
            <h1>Thaigit · Thống kê (${today}, giờ VN)</h1>
            <p class="note">Chỉ đọc. Không có IP, ID gốc hay nội dung nào được lưu.</p>
            ${table('Người dùng (chỉ máy đã bật thống kê)', ['Chỉ số', 'Giá trị'], summary)}
            ${table('Lượt tải qua trang chủ — 30 ngày', ['Ngày', 'macOS', 'Windows', 'Tổng'], downloads)}
            ${table('Phiên bản đang dùng', ['Nền tảng', 'Phiên bản', 'Máy (7 ngày)'], versions)}
            ${table('DAU theo ngày (đã gộp)', ['Ngày', 'Nền tảng', 'DAU'], dau)}
            ${table(
              'AI — 30 ngày',
              [
                'Ngày',
                'Tính năng',
                'Thành công',
                'Lỗi',
                'Huỷ',
                'Token',
                'Chờ TB (ms)',
                'Chữ đầu TB (ms)',
                'Tổng',
              ],
              ai,
            )}
            ${table('AI — lỗi', ['Mã lỗi', 'Số lần (30 ngày)'], errors)}
          </body>
        </html>`,
    );
  });
  return app;
}
