# Generates a fast-import stream: 30k commits, at most 12 feature branches open at a time (merged into main gradually;
# already-merged branch refs are kept → ~878 branches) plus 199 tags ≈ 1.077 refs.
# Usage: python3 make-big-repo.py | git fast-import
import sys, random
random.seed(7)
out = sys.stdout.buffer
def w(s): out.write(s.encode())
mark = 0
t = 1600000000
authors = ["Phan Thái <thai@example.com>", "Lê Minh Châu <chau@example.com>", "Nguyễn Văn An <an@example.com>", "Trần Thị Bình <binh@example.com>"]
def commit(ref, parents, msg, path, content):
    global mark, t
    mark += 1; t += 60
    data = msg.encode()
    a = random.choice(authors)
    w(f"commit {ref}\nmark :{mark}\nauthor {a} {t} +0700\ncommitter {a} {t} +0700\ndata {len(data)}\n")
    out.write(data); w("\n")
    if parents:
        w(f"from :{parents[0]}\n")
        for p in parents[1:]: w(f"merge :{p}\n")
    c = content.encode()
    w(f"M 644 inline {path}\ndata {len(c)}\n"); out.write(c); w("\n\n")
    return mark
main = commit("refs/heads/main", [], "Khởi tạo", "README.md", "repo lớn\n")
feature_tips = {}
n = 1
while n < 30000:
    r = random.random()
    if r < 0.03 and len(feature_tips) < 12:
        name = f"feature/f{n}"
        feature_tips[name] = commit(f"refs/heads/{name}", [main], f"Bắt đầu {name}", f"{name}.txt", f"{n}\n")
    elif r < 0.45 and feature_tips:
        name = random.choice(list(feature_tips))
        feature_tips[name] = commit(f"refs/heads/{name}", [feature_tips[name]], f"Làm tiếp {name} #{n}", f"{name}.txt", f"{n}\n")
    elif r < 0.5 and feature_tips:
        name = random.choice(list(feature_tips))
        main = commit("refs/heads/main", [main, feature_tips.pop(name)], f"Merge branch '{name}'", "merges.txt", f"{n}\n")
    else:
        main = commit("refs/heads/main", [main], f"Sửa lỗi số {n}", f"src/file{n % 300}.txt", f"{n}\n")
    if n % 150 == 0:
        w(f"reset refs/tags/v{n//150}\nfrom :{main}\n\n")
    n += 1
for name, tip in feature_tips.items():
    w(f"reset refs/heads/{name}\nfrom :{tip}\n\n")
