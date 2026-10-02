/**
 * Cây nhánh theo dấu "/" cho sidebar (port `BranchNode` của SidebarView.swift): `feature/a`, `feature/b` → thư mục `feature`.
 * Thư mục trước, nhánh lá sau (giữ thứ tự đầu vào). Chỉ tính cấu trúc — việc "chỉ dựng node đang mở" do component làm.
 */
import type { GitRef } from '@thaigit/core';

export interface BranchNode {
  /** Duy nhất giữa các node anh em: `folder:<đường dẫn>` hoặc tên đầy đủ của ref. */
  readonly id: string;
  readonly name: string;
  /** Có = nhánh lá; `null` = thư mục. */
  readonly ref: GitRef | null;
  readonly children: readonly BranchNode[];
  /** Số nhánh bên trong (tính cả thư mục con); nhánh lá là 1. */
  readonly leafCount: number;
}

/** Thư mục nhỏ mở sẵn để thấy ngay các nhánh; thư mục lớn hơn mức này thu gọn cho nhẹ. */
export const FOLDER_COLLAPSE_THRESHOLD = 30;
/** Số hàng dựng sẵn mỗi cấp và số hàng thêm mỗi lần bấm "Hiện thêm". */
export const PAGE_SIZE = 50;
export const PAGE_STEP = 200;

interface Folder {
  folders: Map<string, Folder>;
  leaves: { name: string; ref: GitRef }[];
}

function newFolder(): Folder {
  return { folders: new Map(), leaves: [] };
}

export function buildBranchTree(refs: readonly GitRef[], nameOf: (ref: GitRef) => string): BranchNode[] {
  const root = newFolder();
  for (const ref of refs) {
    const full = nameOf(ref);
    const parts = full.split('/').filter((part) => part !== '');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let child = folder.folders.get(part);
      if (child === undefined) {
        child = newFolder();
        folder.folders.set(part, child);
      }
      folder = child;
    }
    folder.leaves.push({ name: parts[parts.length - 1] ?? full, ref });
  }

  const convert = (folder: Folder, prefix: string): BranchNode[] => {
    const nodes: BranchNode[] = [];
    for (const [name, child] of folder.folders) {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      const children = convert(child, path);
      nodes.push({
        id: `folder:${path}`,
        name,
        ref: null,
        children,
        leafCount: children.reduce((total, node) => total + node.leafCount, 0),
      });
    }
    for (const leaf of folder.leaves) {
      nodes.push({ id: leaf.ref.fullName, name: leaf.name, ref: leaf.ref, children: [], leafCount: 1 });
    }
    return nodes;
  };
  return convert(root, '');
}

/** Thư mục có mở sẵn không (Swift: `count <= 30`). */
export function folderStartsExpanded(leafCount: number): boolean {
  return leafCount <= FOLDER_COLLAPSE_THRESHOLD;
}

/** Số hàng sẽ thêm khi bấm "Hiện thêm" và số hàng còn lại. */
export function nextPage(total: number, shown: number): { step: number; remaining: number } {
  const remaining = Math.max(0, total - shown);
  return { step: Math.min(remaining, PAGE_STEP), remaining };
}
