/**
 * Branch tree keyed on "/" for the sidebar (a port of `BranchNode` in SidebarView.swift): `feature/a`,
 * `feature/b` → folder `feature`. Folders first, leaf branches after (input order preserved inside a group).
 * Only the structure is computed — "build just the open nodes" is the component's job.
 *
 * The result is memoised by the (refs array, nameOf function) pair — both are stable between real changes
 * (RepoStore replaces the array, Svelte re-evaluates a derived only when a dependency changes), so the
 * sidebar can re-render for unrelated reasons (section toggles, typing a filter, hover states) without
 * rebuilding the tree for every remote group on every render.
 */
import type { GitRef } from '@thaigit/core';

export interface BranchNode {
  /** Unique across sibling nodes: `folder:<path>` or the ref's full name. */
  readonly id: string;
  readonly name: string;
  /** Set for a leaf branch; `null` = a folder. */
  readonly ref: GitRef | null;
  readonly children: readonly BranchNode[];
  /** Number of branches inside (child folders included); a leaf branch is 1. */
  readonly leafCount: number;
}

/** Small folders start expanded so branches are visible at once; bigger ones collapse to stay cheap. */
export const FOLDER_COLLAPSE_THRESHOLD = 30;
/** Rows pre-built per level, and rows added per "Show more" click. */
export const PAGE_SIZE = 50;
export const PAGE_STEP = 200;

interface Folder {
  folders: Map<string, Folder>;
  leaves: { name: string; ref: GitRef }[];
}

function newFolder(): Folder {
  return { folders: new Map(), leaves: [] };
}

let cacheRefs: readonly GitRef[] | null = null;
let cacheNameOf: ((ref: GitRef) => string) | null = null;
let cacheResult: BranchNode[] = [];

export function buildBranchTree(refs: readonly GitRef[], nameOf: (ref: GitRef) => string): BranchNode[] {
  if (refs === cacheRefs && nameOf === cacheNameOf) return cacheResult;
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
  cacheRefs = refs;
  cacheNameOf = nameOf;
  cacheResult = convert(root, '');
  return cacheResult;
}

/** Whether a folder starts expanded (Swift: `count <= 30`). */
export function folderStartsExpanded(leafCount: number): boolean {
  return leafCount <= FOLDER_COLLAPSE_THRESHOLD;
}

/** Rows a "Show more" click will add, and how many are left. */
export function nextPage(total: number, shown: number): { step: number; remaining: number } {
  const remaining = Math.max(0, total - shown);
  return { step: Math.min(remaining, PAGE_STEP), remaining };
}
