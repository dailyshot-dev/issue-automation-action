import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("config", () => {
  const originalRuntimeDir = process.env.ISSUE_AUTOMATION_RUNTIME_DIR;
  const originalRunnerTemp = process.env.RUNNER_TEMP;

  afterEach(() => {
    restoreEnv("ISSUE_AUTOMATION_RUNTIME_DIR", originalRuntimeDir);
    restoreEnv("RUNNER_TEMP", originalRunnerTemp);
  });

  it("loads value-based classification and dependency config", () => {
    const config = loadConfig("examples/dailyshot-dbt.issue-automation.yml");

    expect(config.defaultKind).toBe("task");
    expect(config.kindRules[0]).toMatchObject({
      value: "bug",
    });
    expect(config.dependencies[0]).toMatchObject({
      key: "cli",
      owner: "dailyshot-dev",
      repo: "dailyshot-cli",
    });
  });

  it("overrides repository runtime config with an action runtime directory", () => {
    process.env.ISSUE_AUTOMATION_RUNTIME_DIR = "/tmp/issue-automation";
    delete process.env.RUNNER_TEMP;

    const config = loadConfig("examples/dailyshot-dbt.issue-automation.yml");

    expect(config.runtime.dir).toBe("/tmp/issue-automation");
    expect(config.runtime.issueContextFile).toBe("issue-context.md");
    expect(config.runtime.runnerResultFile).toBe("runner-result.json");
  });

  it("uses RUNNER_TEMP when an explicit runtime override is absent", () => {
    delete process.env.ISSUE_AUTOMATION_RUNTIME_DIR;
    process.env.RUNNER_TEMP = "/tmp/actions-runner";

    const config = loadConfig("examples/dailyshot-dbt.issue-automation.yml");

    expect(config.runtime.dir).toBe("/tmp/actions-runner/issue-automation");
  });
});

/**
 * Restores a process environment variable without converting undefined to a string.
 */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
