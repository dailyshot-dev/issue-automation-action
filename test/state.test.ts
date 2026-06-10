import type { Context } from "@actions/github/lib/context";
import { describe, expect, it, vi } from "vitest";

import { defaultAutomationState, readAutomationState, renderAutomationState, STATE_MARKER } from "../src/state";
import type { Octokit } from "../src/github";
import type { Issue } from "../src/types";

describe("state", () => {
  it("renders automation state as hidden JSON and visible summary", () => {
    const state = defaultAutomationState({
      status: "working",
      kind: "bug",
      area: "data",
      dependencies: ["dbt"],
      maintainerNeeded: false,
      branch: "ai/issue-1-example",
    });

    expect(renderAutomationState(state)).toContain(STATE_MARKER);
    expect(renderAutomationState(state)).toContain('"status": "working"');
    expect(renderAutomationState(state)).toContain("- dependencies: `dbt`");
  });

  it("reads automation state from a marker comment", async () => {
    const state = defaultAutomationState({
      status: "needs_dependency",
      kind: "feature",
      area: "model",
      dependencies: ["dbt", "cli"],
      maintainerNeeded: false,
      summary: "runner returned --> safely",
    });
    const octokit = octokitWithComments([{
      id: 1,
      body: renderAutomationState(state),
      html_url: "https://github.com/dailyshot-dev/example/issues/1#issuecomment-1",
    }]);

    await expect(readAutomationState(octokit, context(), issue())).resolves.toEqual(state);
    const rendered = renderAutomationState(state);
    expect(rendered.indexOf("-->")).toBe(rendered.indexOf("\n-->") + 1);
  });
});

/**
 * Builds the small Octokit surface needed by state comment tests.
 */
function octokitWithComments(comments: unknown[]): Octokit {
  const listComments = vi.fn();
  return {
    paginate: vi.fn().mockResolvedValue(comments),
    rest: {
      issues: {
        listComments,
      },
    },
  } as unknown as Octokit;
}

/**
 * Builds a minimal GitHub Actions context for state comment tests.
 */
function context(): Context {
  return {
    repo: {
      owner: "dailyshot-dev",
      repo: "example",
    },
  } as Context;
}

/**
 * Builds a minimal issue for state comment tests.
 */
function issue(): Issue {
  return {
    id: 1,
    number: 1,
    title: "Example",
    html_url: "https://github.com/dailyshot-dev/example/issues/1",
  };
}
