// Atomic, link-safe writes for the omo-coworkers installer.
//
// The owner's live deployment hard-links the global and dotfiles copies of
// opencode.json / oh-my-opencode-slim.json (same inode, link count 2), and the
// global prompt directory is a symlink into dotfiles. An in-place
// writeFileSync on such a path writes through the link and mutates production
// before activation. Therefore every write this installer performs is:
//   1. computed in full first (plan/merge render the final bytes),
//   2. written to a temporary file in the SAME directory (same filesystem),
//   3. committed with rename(), which atomically replaces the directory entry
//      with a fresh inode instead of writing through existing links.
// Managed paths that are themselves symlinks are never rewritten; the planner
// reports them as conflicts so link boundaries stay with the owner.

import { writeFileSync, renameSync, rmSync, lstatSync } from "node:fs";
import { randomBytes } from "node:crypto";

export function atomicWriteFileSync(absPath, data) {
  const tmp = `${absPath}.ocw-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, absPath);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
}

/** True when the path exists AND is a symlink (does not follow the link). */
export function isSymlinkPath(absPath) {
  try {
    return lstatSync(absPath).isSymbolicLink();
  } catch {
    return false;
  }
}
