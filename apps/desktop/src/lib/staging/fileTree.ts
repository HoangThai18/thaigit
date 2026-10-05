// Danh sách file thay đổi dạng cây thư mục (nút Path / Tree như GitKraken; port FileTree.swift): dựng thành các hàng phẳng có
// độ sâu để vẽ trong VirtualList. Thư mục chỉ có đúng một thư mục con (và không có file) gộp thành một hàng "src/app/views".

import { fileChangeName, type FileChange } from '@thaigit/core';
import { compareNatural } from '../format/natural.ts';

export type FileTreeRow =
  | {
      readonly kind: 'folder';
      /** Đường dẫn đầy đủ (khoá gập / mở). */
      readonly path: string;
      /** Phần hiển thị, có thể gộp nhiều cấp. */
      readonly name: string;
      readonly depth: number;
      /** Số file bên trong. */
      readonly count: number;
    }
  | { readonly kind: 'file'; readonly change: FileChange; readonly depth: number };

interface Node {
  folders: Map<string, Node>;
  files: FileChange[];
  count: number;
}

function node(): Node {
  return { folders: new Map(), files: [], count: 0 };
}

/** Hàng của cây; thư mục có `path` trong `collapsed` thì ẩn phần bên trong. Thư mục trước file, mỗi nhóm xếp theo tên. */
export function fileTreeRows(
  changes: readonly FileChange[],
  collapsed: ReadonlySet<string> = new Set(),
): FileTreeRow[] {
  const root = node();
  for (const change of changes) {
    let current = root;
    current.count++;
    const parts = change.path.split('/');
    for (const part of parts.slice(0, -1)) {
      let next = current.folders.get(part);
      if (!next) {
        next = node();
        current.folders.set(part, next);
      }
      current = next;
      current.count++;
    }
    current.files.push(change);
  }
  const rows: FileTreeRow[] = [];
  append(root, '', 0, collapsed, rows);
  return rows;
}

function append(
  current: Node,
  prefix: string,
  depth: number,
  collapsed: ReadonlySet<string>,
  rows: FileTreeRow[],
): void {
  for (const name of [...current.folders.keys()].sort(compareNatural)) {
    let folder = current.folders.get(name) as Node;
    let display = name;
    let path = prefix + name;
    // Gộp chuỗi thư mục chỉ có một thư mục con: "src" → "src/app" → "src/app/views".
    while (folder.files.length === 0 && folder.folders.size === 1) {
      const [childName, child] = [...folder.folders][0] as [string, Node];
      display += `/${childName}`;
      path += `/${childName}`;
      folder = child;
    }
    rows.push({ kind: 'folder', path, name: display, depth, count: folder.count });
    if (!collapsed.has(path)) append(folder, `${path}/`, depth + 1, collapsed, rows);
  }
  for (const file of [...current.files].sort((a, b) =>
    compareNatural(fileChangeName(a), fileChangeName(b)),
  )) {
    rows.push({ kind: 'file', change: file, depth });
  }
}
