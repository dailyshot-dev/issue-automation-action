import { describe, expect, it } from "vitest";

import { renderTemplate, slugify } from "../src/rules";

describe("rules", () => {
  it("renders issue template values", () => {
    expect(renderTemplate("[{repo} #{issue_number}]", {
      owner: "dailyshot-dev",
      repo: "dailyshot-claude-plugin",
      issueNumber: 123,
      issueTitle: "테스트",
      parentUrl: "https://github.com/dailyshot-dev/dailyshot-claude-plugin/issues/123",
    })).toBe("[dailyshot-claude-plugin #123]");
  });

  it("slugifies branch suffix", () => {
    expect(slugify("Fix CLI manifest!")).toBe("fix-cli-manifest");
  });
});
