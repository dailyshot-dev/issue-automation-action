import fs from "fs";
import os from "os";
import path from "path";
import type * as core from "@actions/core";
import type { Context } from "@actions/github/lib/context";
import { describe, expect, it, vi } from "vitest";

import { type Octokit } from "../src/github";
import { runPhase } from "../src/phases";
import { defaultAutomationState, renderAutomationState } from "../src/state";
import type { AutomationConfig, Issue, IssueComment } from "../src/types";

describe("phases", () => {
  it("preserves a blocked state when intake runs again", async () => {
    const previousState = defaultAutomationState({
      status: "needs_info",
      kind: "bug",
      area: "api",
      maintainerNeeded: false,
      summary: "추가 정보가 필요합니다.",
    });
    const { octokit, updateComment } = octokitMock({
      comments: [stateComment(previousState)],
    });

    await runPhase({
      core: coreMock(),
      octokit,
      context: context(),
      config: config(),
      inputs: inputs("intake"),
    });

    const updatedBody = updateComment.mock.calls.at(-1)?.[0].body as string;
    expect(updatedBody).toContain('"status": "needs_info"');
    expect(updatedBody).toContain("- status: `needs_info`");
  });

  it("marks PR finalization as maintainer-needed when dependency issue creation fails", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-automation-action-"));
    fs.writeFileSync(path.join(runtimeDir, "runner-result.json"), JSON.stringify({
      action: "create_pr",
      summary: "PR은 생성됐지만 dependency issue 생성이 필요합니다.",
      needsIssues: ["dbt"],
    }));
    const { octokit, createIssue, updateComment } = octokitMock({
      comments: [stateComment(defaultAutomationState({ status: "working" }))],
      createIssueError: new Error("dependency token denied"),
    });

    try {
      await runPhase({
        core: coreMock(),
        octokit,
        context: context(),
        config: config(runtimeDir),
        inputs: {
          ...inputs("finalize_pr"),
          prUrl: "https://github.com/dailyshot-dev/example/pull/20",
        },
      });
    } finally {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }

    const updatedBody = updateComment.mock.calls.at(-1)?.[0].body as string;
    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({
      owner: "dailyshot-dev",
      repo: "dailyshot-dbt",
    }));
    expect(updatedBody).toContain('"status": "needs_maintainer"');
    expect(updatedBody).toContain("- status: `needs_maintainer`");
    expect(updatedBody).toContain("- dbt issue creation error: dependency token denied");
    expect(updatedBody).toContain("- PR: https://github.com/dailyshot-dev/example/pull/20");
  });
});

/**
 * Builds the GitHub API surface used by phase transition tests.
 */
function octokitMock(params: {
  comments: IssueComment[];
  createIssueError?: Error;
}): {
  octokit: Octokit;
  createIssue: ReturnType<typeof vi.fn>;
  updateComment: ReturnType<typeof vi.fn>;
} {
  const createIssue = vi.fn();
  if (params.createIssueError) {
    createIssue.mockRejectedValue(params.createIssueError);
  } else {
    createIssue.mockResolvedValue({
      data: {
        id: 200,
        html_url: "https://github.com/dailyshot-dev/dailyshot-dbt/issues/200",
      },
    });
  }

  const updateComment = vi.fn().mockResolvedValue({});
  const createComment = vi.fn().mockResolvedValue({});
  const listComments = vi.fn();
  const getIssue = vi.fn().mockResolvedValue({ data: issue() });
  const paginate = vi.fn().mockResolvedValue(params.comments);

  return {
    octokit: {
      paginate,
      request: vi.fn().mockResolvedValue({}),
      rest: {
        issues: {
          get: getIssue,
          listComments,
          updateComment,
          createComment,
          create: createIssue,
        },
      },
    } as unknown as Octokit,
    createIssue,
    updateComment,
  };
}

/**
 * Returns a minimal action core mock for phases that set outputs conditionally.
 */
function coreMock(): typeof core {
  return {
    setOutput: vi.fn(),
  } as unknown as typeof core;
}

/**
 * Builds a repository config with one dependency route for runner-result tests.
 */
function config(runtimeDir = ".github/ai/runtime"): AutomationConfig {
  return {
    runtime: {
      dir: runtimeDir,
      issueContextFile: "issue-context.md",
      runnerResultFile: "runner-result.json",
    },
    kindRules: [{
      value: "bug",
      patterns: ["bug"],
    }],
    defaultKind: "task",
    areaRules: [{
      value: "api",
      patterns: ["api"],
    }],
    maintainerPatterns: [],
    dependencies: [{
      key: "dbt",
      owner: "dailyshot-dev",
      repo: "dailyshot-dbt",
      marker: "<!-- dailyshot-dbt-sub-issue -->",
      patterns: ["dbt"],
      autoCreate: false,
      bodyNotes: ["dbt 변경 필요 여부를 확인합니다."],
      titlePrefix: "[{repo} #{issue_number}]",
    }],
  };
}

/**
 * Provides action inputs with defaults shared by phase tests.
 */
function inputs(phase: "intake" | "finalize_pr") {
  return {
    phase,
    issueNumber: "20",
    forceAi: false,
    configPath: ".github/issue-automation.yml",
    agentContractPath: ".github/ai/issue-agent-contract.md",
  };
}

/**
 * Creates a state marker comment for an existing parent issue.
 */
function stateComment(state: Parameters<typeof renderAutomationState>[0]): IssueComment {
  return {
    id: 1,
    body: renderAutomationState(state),
    html_url: "https://github.com/dailyshot-dev/example/issues/20#issuecomment-1",
  };
}

/**
 * Builds a minimal GitHub Actions context for phase tests.
 */
function context(): Context {
  return {
    payload: {},
    repo: {
      owner: "dailyshot-dev",
      repo: "example",
    },
  } as Context;
}

/**
 * Builds the parent issue used by every phase test.
 */
function issue(): Issue {
  return {
    id: 20,
    number: 20,
    title: "API bug",
    body: "API 응답에서 오류가 발생합니다.",
    html_url: "https://github.com/dailyshot-dev/example/issues/20",
  };
}
