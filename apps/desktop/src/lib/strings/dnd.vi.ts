/**
 * Strings for drag and drop (branches, tags, files). Reached through `vi.dnd.*`.
 */
export const dnd = {
  mergeInto: (source: string, target: string) => `Merge ${source} vào ${target}`,
  checkoutAndMerge: (source: string, target: string) => `Checkout ${target} rồi merge ${source} vào`,
  rebaseOnto: (source: string, target: string) => `Rebase ${source} lên ${target}`,
  fastForward: (target: string, source: string) => `Fast-forward ${target} theo ${source}`,
  pushTo: (source: string, target: string) => `Push ${source} lên ${target}`,
  pushTagTo: (tag: string, remote: string) => `Push tag ${tag} lên ${remote}`,
  noTagDrop: 'Không có thao tác khi thả lên tag',
  files: (count: number) => (count === 1 ? '1 file' : `${count} file`),
  hintRef: 'Thả lên nhánh để merge / rebase, lên remote để push',
  hintStage: 'Thả vào “Đã stage” để stage',
  hintUnstage: 'Thả vào “Chưa stage” để bỏ stage',
} as const;
