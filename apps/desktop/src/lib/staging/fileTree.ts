// Changed files as a directory tree (the Path / Tree switch like GitKraken, a port of FileTree.swift): built
// into flat rows carrying a depth so VirtualList can draw them. A folder with exactly one subfolder and no
// files collapses into a single "src/app/views" row.

import { fileChangeName, type FileChange } from '@thaigit/core';
import { compareNatural } from '../format/natural.ts';

export type FileTreeRow =
  | {
      readonly kind: 'folder';
      /** Full path (the collapse / expand key). */
      readonly path: string;
      /** Display part, which may merge several levels. */
      readonly name: string;
      readonly depth: number;
      /** Number of files inside. */
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

/** A tree row; a folder whose `path` is in `collapsed` hides its contents. Folders before files, each group sorted by name. */
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
    // Merge runs of folders that have a single subfolder: "src" → "src/app" → "src/app/views".
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
