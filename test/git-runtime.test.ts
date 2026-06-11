import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

describe("git runtime handling", () => {
  it("adds repository changes without failing on ignored runtime files", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-automation-git-"));
    try {
      git(repoDir, "init");
      fs.mkdirSync(path.join(repoDir, ".github/ai/runtime"), { recursive: true });
      fs.writeFileSync(path.join(repoDir, ".gitignore"), ".github/ai/runtime\n");
      fs.writeFileSync(path.join(repoDir, ".github/ai/runtime/issue-context.md"), "runtime context");
      fs.writeFileSync(path.join(repoDir, ".github/ai/runtime/runner-result.json"), "{}");
      fs.writeFileSync(path.join(repoDir, "model.sql"), "select 1 as id\n");

      git(repoDir, "add", "--all", "--", ".");

      expect(gitOutput(repoDir, "diff", "--cached", "--name-only")).toBe([
        ".gitignore",
        "model.sql",
      ].join("\n"));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

/**
 * Runs a git command in a temporary fixture repository.
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
  });
}

/**
 * Runs a git command and returns trimmed stdout for assertions.
 */
function gitOutput(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}
