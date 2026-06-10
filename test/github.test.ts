import type { Context } from "@actions/github/lib/context";
import { describe, expect, it, vi } from "vitest";

import { listIssueComments, type Octokit } from "../src/github";
import type { Issue } from "../src/types";

describe("github", () => {
  it("paginates issue comments", async () => {
    const listComments = vi.fn();
    const paginate = vi.fn().mockResolvedValue([
      {
        id: 1,
        body: "first page marker",
        html_url: "https://github.com/dailyshot-dev/example/issues/10#issuecomment-1",
      },
      {
        id: 2,
        body: null,
        html_url: "https://github.com/dailyshot-dev/example/issues/10#issuecomment-2",
      },
    ]);
    const octokit = {
      paginate,
      rest: {
        issues: {
          listComments,
        },
      },
    } as unknown as Octokit;
    const context = {
      repo: {
        owner: "dailyshot-dev",
        repo: "example",
      },
    } as Context;
    const issue: Issue = {
      id: 100,
      number: 10,
      title: "Example",
      html_url: "https://github.com/dailyshot-dev/example/issues/10",
    };

    await expect(listIssueComments(octokit, context, issue)).resolves.toEqual([
      {
        id: 1,
        body: "first page marker",
        html_url: "https://github.com/dailyshot-dev/example/issues/10#issuecomment-1",
      },
      {
        id: 2,
        body: null,
        html_url: "https://github.com/dailyshot-dev/example/issues/10#issuecomment-2",
      },
    ]);
    expect(paginate).toHaveBeenCalledWith(listComments, {
      owner: "dailyshot-dev",
      repo: "example",
      issue_number: 10,
      per_page: 100,
    });
  });
});
