import { describe, expect, it } from "vitest";

import { dependencyKeysFromResult } from "../src/runner-result";
import type { AutomationConfig, DependencyConfig } from "../src/types";

describe("runner-result", () => {
  it("extracts only configured dependency issue keys", () => {
    const config = configWithDependencies(["cli", "dbt", "infra"]);

    expect(dependencyKeysFromResult(config, {
      action: "needs_infra",
      needsIssues: ["dbt", "unknown"],
      needsCliIssue: true,
      needsDbtIssue: true,
    })).toEqual(["dbt", "infra", "cli"]);
  });

  it("returns no dependency keys when runner result is absent", () => {
    const config = configWithDependencies(["cli"]);

    expect(dependencyKeysFromResult(config, null)).toEqual([]);
  });
});

/**
 * Builds a minimal automation config for dependency key extraction tests.
 */
function configWithDependencies(keys: string[]): AutomationConfig {
  return {
    runtime: {
      dir: ".github/ai/runtime",
      issueContextFile: "issue-context.md",
      runnerResultFile: "runner-result.json",
    },
    kindRules: [],
    defaultKind: "task",
    areaRules: [],
    maintainerPatterns: [],
    dependencies: keys.map(dependencyConfig),
  };
}

/**
 * Creates a dependency config with required fields populated for tests.
 */
function dependencyConfig(key: string): DependencyConfig {
  return {
    key,
    owner: "dailyshot-dev",
    repo: `dailyshot-${key}`,
    marker: `<!-- ${key}-sub-issue -->`,
    patterns: [],
    autoCreate: false,
    bodyNotes: [],
    titlePrefix: "[{repo} #{issue_number}]",
  };
}
