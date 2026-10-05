#!/usr/bin/env python3
"""Kiểm bản tiếng Anh của app macOS (Resources/en.lproj).

Build `Nhanh` với `-emit-localized-strings` để trình biên dịch trích MỌI khoá bản địa hoá (Text, Button, Label,
String(localized:)… — kể cả định dạng tham số %@ / %lld chính xác), rồi so với Localizable.strings + .stringsdict:
  - khoá có chữ tiếng Việt mà chưa có bản tiếng Anh → lỗi;
  - bản dịch khác tham số với khoá (thiếu %@, sai %lld…) → lỗi;
  - bản dịch không còn khoá nào trong code dùng → cảnh báo (có thể xoá).

Chạy: python3 scripts/check-mac-strings.py   (cần Swift; chỉ có Command Line Tools thì tự chọn SDK như build-app.sh)
Chuỗi mới viết thẳng kiểu String (không phải Text("…")) thì bọc bằng String(localized: "…") để được trích.
"""
import glob
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRINGS = os.path.join(ROOT, "Resources/en.lproj/Localizable.strings")
STRINGSDICT = os.path.join(ROOT, "Resources/en.lproj/Localizable.stringsdict")
VIETNAMESE = re.compile(r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]", re.I)
SPEC = re.compile(r"%(?:\d+\$)?(lld|ld|d|@|lf|f)")


def sdk_env():
    env = dict(os.environ)
    xcode = subprocess.run(["xcode-select", "-p"], capture_output=True, text=True).stdout
    if "Xcode.app" not in xcode:
        for sdk in ("MacOSX26.sdk", "MacOSX26.5.sdk", "MacOSX15.sdk"):
            path = f"/Library/Developer/CommandLineTools/SDKs/{sdk}"
            if os.path.isdir(path):
                env["SDKROOT"] = path
                break
    return env


def extracted_keys():
    out = tempfile.mkdtemp(prefix="thaigit-strings-")
    # Touch every file so the compiler re-extracts even the unchanged ones.
    for path in glob.glob(os.path.join(ROOT, "Sources/**/*.swift"), recursive=True):
        os.utime(path)
    build = subprocess.run(
        ["swift", "build", "--product", "Nhanh", "-Xswiftc", "-emit-localized-strings",
         "-Xswiftc", "-emit-localized-strings-path", "-Xswiftc", out],
        cwd=ROOT, env=sdk_env(), capture_output=True, text=True,
    )
    if build.returncode != 0:
        sys.exit(build.stdout + build.stderr + "\nBuild lỗi — sửa trước rồi chạy lại.")
    keys = {}
    for path in glob.glob(os.path.join(out, "*.stringsdata")):
        data = json.load(open(path))
        source = os.path.relpath(data["source"], ROOT)
        for items in data.get("tables", {}).values():
            for item in items:
                keys.setdefault(item["key"], f"{source}:{item['location']['startingLine']}")
    return keys


def translations():
    plain = json.loads(subprocess.run(["plutil", "-convert", "json", "-o", "-", STRINGS],
                                      capture_output=True, text=True, check=True).stdout)
    plurals = {}
    if os.path.exists(STRINGSDICT):
        for key, entry in plistlib.load(open(STRINGSDICT, "rb")).items():
            rule = next(value for name, value in entry.items() if isinstance(value, dict))
            plurals[key] = [rule.get("one", ""), rule["other"]]
    return plain, plurals


def main():
    keys = extracted_keys()
    plain, plurals = translations()
    errors = []
    for key, where in sorted(keys.items(), key=lambda kv: kv[1]):
        if key not in plain and key not in plurals and VIETNAMESE.search(key):
            errors.append(f"thiếu bản tiếng Anh: {json.dumps(key, ensure_ascii=False)} ({where})")
    expected = lambda key: sorted(SPEC.findall(key))
    for key, value in plain.items():
        if sorted(SPEC.findall(value)) != expected(key):
            errors.append(f"sai tham số: {json.dumps(key, ensure_ascii=False)} → {json.dumps(value, ensure_ascii=False)}")
    for key, forms in plurals.items():
        for form in forms:
            if form and sorted(SPEC.findall(form)) != expected(key):
                errors.append(f"sai tham số (số nhiều): {json.dumps(key, ensure_ascii=False)} → {json.dumps(form, ensure_ascii=False)}")
    unused = sorted((set(plain) | set(plurals)) - set(keys))
    for key in unused:
        print(f"cảnh báo: bản dịch không còn dùng: {json.dumps(key, ensure_ascii=False)}")
    for error in errors:
        print(error)
    print(f"{len(keys)} khoá trong code, {len(plain) + len(plurals)} bản dịch, {len(errors)} lỗi.")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
