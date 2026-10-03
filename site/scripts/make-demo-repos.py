#!/usr/bin/env python3
"""Dựng các repo demo để chụp ảnh giao diện (docs/screenshots) — dùng bởi site/scripts/take-shots.sh.

    python3 site/scripts/make-demo-repos.py <thư mục>

Tạo trong <thư mục>:
  demo-shop/   repo cửa hàng nhỏ: 4 tác giả, nhánh feature/bugfix đã merge, tag, remote `origin` (bare), stash,
               main đi trước origin 2 commit, thay đổi chưa commit (sửa app.js + logo.png, file mới, products.js đã stage)
  origin.git/  remote của demo-shop
  xung-dot/    đang merge feature/doi-cong vào main, server.js xung đột 2 đoạn
  large/       30.000 commit, ~1.100 nhánh + tag (packages/core/test/fixtures/make-big-repo.py)
Mọi lệnh git chạy với cấu hình cô lập (không đọc ~/.gitconfig). Cần Pillow (logo trước / sau).
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ENV = {
    **os.environ,
    'GIT_CONFIG_NOSYSTEM': '1',
    'GIT_CONFIG_GLOBAL': '/dev/null',
    'GIT_TERMINAL_PROMPT': '0',
}
PEOPLE = {
    'PT': ('Phan Thái', 'thai@example.com'),
    'LC': ('Lê Minh Châu', 'chau@example.com'),
    'NA': ('Nguyễn Văn An', 'an@example.com'),
    'TB': ('Trần Thị Bình', 'binh@example.com'),
    'DH': ('Đỗ Quốc Huy', 'huy@example.com'),
}
NOW = int(time.time())


def git(repo: Path, *args: str, who: str = 'PT', age_hours: float = 0, check: bool = True) -> str:
    name, email = PEOPLE[who]
    date = f'{NOW - int(age_hours * 3600)} +0700'
    env = {
        **ENV,
        'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email, 'GIT_AUTHOR_DATE': date,
        'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email, 'GIT_COMMITTER_DATE': date,
    }
    result = subprocess.run(['git', *args], cwd=repo, env=env, capture_output=True, text=True)
    if check and result.returncode != 0:
        sys.exit(f'git {" ".join(args)} lỗi:\n{result.stderr}')
    return result.stdout


def write(repo: Path, path: str, text: str) -> None:
    file = repo / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text, encoding='utf-8')


def commit(repo: Path, message: str, who: str, age_hours: float, files: dict[str, str]) -> None:
    for path, text in files.items():
        write(repo, path, text)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', message, who=who, age_hours=age_hours)


def merge(repo: Path, branch: str, who: str, age_hours: float) -> None:
    git(repo, 'merge', '-q', '--no-ff', '--no-edit', branch, who=who, age_hours=age_hours)


def logos(directory: Path) -> tuple[Path, Path]:
    """Logo trước (xám) / sau (màu) 128 px từ logo của trang chủ."""
    source = Image.open(ROOT / 'site' / 'public' / 'logo-256.png').convert('RGBA').resize((128, 128), Image.LANCZOS)
    after = directory / 'logo-after.png'
    before = directory / 'logo-before.png'
    source.save(after)
    gray = ImageOps.grayscale(source.convert('RGB')).convert('RGBA')
    gray.putalpha(source.getchannel('A'))
    gray.save(before)
    return before, after


APP_V1 = """const app = require('express')();
const products = require('./products');

app.get('/', (req, res) => res.send('Xin chào'));
app.use(require('express').json());
app.get('/products', (req, res) => res.json(products));

app.listen(3000);
"""

APP_WIP = """const app = require('express')();
const products = require('./products');
const { login } = require('./auth');

app.get('/', (req, res) => res.send('Xin chào, Demo Shop!'));
app.get('/products', (req, res) => res.json(products));
app.post('/login', (req, res) => {
  const ok = login(req.body.user, req.body.pass);
  res.status(ok ? 200 : 401).json({ ok });
});

app.listen(process.env.PORT || 3000);
"""


def demo_shop(base: Path) -> None:
    repo = base / 'demo-shop'
    origin = base / 'origin.git'
    repo.mkdir()
    git(base, 'init', '-q', '--bare', '-b', 'main', str(origin))
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', str(origin))
    before, after = logos(base)

    commit(repo, 'Khởi tạo dự án', 'PT', 98, {'README.md': '# Demo Shop\n', '.editorconfig': 'root = true\n'})
    commit(repo, 'Thêm server Express cơ bản', 'PT', 96, {'src/app.js': "const express = require('express');\n\napp.listen(3000);\n"})
    commit(repo, 'Thêm package.json', 'NA', 80, {'package.json': '{\n  "name": "demo-shop",\n  "version": "1.0.0"\n}\n'})
    git(repo, 'tag', 'v1.0')

    git(repo, 'switch', '-q', '-c', 'feature/dang-nhap')
    commit(repo, 'Thêm chức năng đăng nhập', 'TB', 76, {'src/auth.js': 'exports.login = (user, pass) => user === pass;\n'})
    commit(repo, 'Kiểm tra dữ liệu đăng nhập rỗng', 'TB', 74,
           {'src/auth.js': 'exports.login = (user, pass) => Boolean(user && pass) && user === pass;\n'})
    git(repo, 'switch', '-q', 'main')
    commit(repo, 'Thêm danh sách sản phẩm', 'NA', 73, {'src/products.js': "module.exports = [{ id: 1, name: 'Áo thun' }];\n"})

    git(repo, 'switch', '-q', '-c', 'feature/giao-dien')
    commit(repo, 'Trang chủ HTML', 'LC', 72, {'public/index.html': '<h1>Demo Shop</h1>\n'})
    git(repo, 'switch', '-q', 'main')
    merge(repo, 'feature/dang-nhap', 'PT', 70)
    git(repo, 'switch', '-q', 'feature/giao-dien')
    commit(repo, 'Thêm CSS cho trang chủ', 'LC', 52, {'public/style.css': 'body { font-family: system-ui; }\n'})
    git(repo, 'switch', '-q', 'main')
    commit(repo, 'Giỏ hàng: thêm sản phẩm và tính tổng tiền', 'PT', 50, {'src/cart.js': 'exports.total = (items) => items.reduce((s, i) => s + i.price * i.qty, 0);\n'})

    git(repo, 'switch', '-q', '-c', 'bugfix/tinh-tien')
    commit(repo, 'Sửa lỗi số lượng âm trong giỏ hàng', 'NA', 49,
           {'src/cart.js': 'exports.total = (items) => items.reduce((s, i) => s + i.price * Math.max(0, i.qty), 0);\n'})
    git(repo, 'switch', '-q', 'main')
    merge(repo, 'bugfix/tinh-tien', 'PT', 48)
    git(repo, 'switch', '-q', 'feature/giao-dien')
    commit(repo, 'Trang giỏ hàng', 'LC', 47, {'public/cart.html': '<h1>Giỏ hàng</h1>\n'})
    git(repo, 'switch', '-q', 'main')
    (repo / 'public').mkdir(exist_ok=True)
    shutil.copy(before, repo / 'public' / 'logo.png')
    commit(repo, 'Cập nhật README: hướng dẫn chạy thử', 'PT', 46,
           {'README.md': '# Demo Shop\n\nChạy thử: `npm install && npm start`\n', 'src/app.js': APP_V1})
    git(repo, 'tag', 'v1.1')

    git(repo, 'switch', '-q', '-c', 'feature/thanh-toan')
    commit(repo, 'Thanh toán (bản nháp)', 'DH', 30, {'src/payment.js': '// TODO: cổng thanh toán\n'})
    git(repo, 'switch', '-q', 'main')

    git(repo, 'push', '-q', 'origin', 'main', 'feature/dang-nhap', 'feature/giao-dien', 'bugfix/tinh-tien',
        'feature/thanh-toan', '--tags')
    git(repo, 'fetch', '-q', 'origin')
    git(repo, 'branch', '-q', '-D', 'feature/thanh-toan')
    for branch in ('main', 'feature/dang-nhap', 'feature/giao-dien', 'bugfix/tinh-tien'):
        git(repo, 'branch', '-q', f'--set-upstream-to=origin/{branch}', branch)

    commit(repo, 'API /products', 'PT', 26, {'src/routes.js': "module.exports = (app) => app.get('/api/products', () => {});\n"})
    commit(repo, 'Thêm logo', 'LC', 25, {'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n'})

    # Stash, rồi thay đổi đang làm.
    write(repo, 'src/promo.js', "exports.discount = (total) => total * 0.9;\n")
    git(repo, 'add', 'src/promo.js')
    git(repo, 'stash', 'push', '-q', '-m', 'Đang thử tính năng khuyến mãi', who='PT', age_hours=20)
    write(repo, 'src/products.js', "module.exports = [\n  { id: 1, name: 'Áo thun', price: 150000 },\n  { id: 2, name: 'Quần jean', price: 420000 },\n];\n")
    git(repo, 'add', 'src/products.js')
    write(repo, 'src/app.js', APP_WIP)
    shutil.copy(after, repo / 'public' / 'logo.png')
    write(repo, 'docs/api.md', '# API\n\n- `GET /products`\n- `POST /login`\n')
    write(repo, '.gitignore', 'node_modules/\n.env\n')


SERVER_BASE = """const config = {
  port: 3000,
  host: "localhost",
  debug: true,
};

function start() {
  console.log("Bắt đầu");
}

module.exports = { config, start };
"""


def conflict(base: Path) -> None:
    repo = base / 'xung-dot'
    repo.mkdir()
    git(repo, 'init', '-q', '-b', 'main')
    commit(repo, 'Khởi tạo server', 'PT', 30, {'server.js': SERVER_BASE})
    git(repo, 'switch', '-q', '-c', 'feature/doi-cong')
    commit(repo, 'Đổi cổng sang 8080', 'NA', 20, {'server.js': SERVER_BASE.replace('3000', '8080').replace(
        'console.log("Bắt đầu")', 'console.log("Server chạy ở cổng 8080")')})
    git(repo, 'switch', '-q', 'main')
    commit(repo, 'Dùng cổng 5000', 'PT', 10, {'server.js': SERVER_BASE.replace('3000', '5000').replace(
        'console.log("Bắt đầu")', 'console.log("Khởi động server…")')})
    git(repo, 'merge', 'feature/doi-cong', check=False)


def large(base: Path) -> None:
    repo = base / 'large'
    repo.mkdir()
    git(repo, 'init', '-q', '-b', 'main')
    stream = subprocess.run([sys.executable, str(ROOT / 'packages/core/test/fixtures/make-big-repo.py')],
                            capture_output=True, check=True).stdout
    subprocess.run(['git', 'fast-import', '--quiet'], cwd=repo, env=ENV, input=stream, check=True)
    git(repo, 'checkout', '-q', '-f', 'main')
    with open(repo / 'README.md', 'a', encoding='utf-8') as handle:
        handle.write('thêm một dòng\n')


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = Path(sys.argv[1]).resolve()
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True)
    demo_shop(base)
    conflict(base)
    large(base)
    print(f'✓ demo-shop, xung-dot, large → {base}')


if __name__ == '__main__':
    main()
