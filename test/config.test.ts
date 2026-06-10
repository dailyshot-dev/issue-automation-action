import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("config", () => {
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
});
