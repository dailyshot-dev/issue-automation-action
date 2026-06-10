import type { Context } from "@actions/github/lib/context";
import { getOctokit } from "@actions/github";

import type { Issue, IssueComment } from "./types";

export type Octokit = ReturnType<typeof getOctokit>;

/**
 * Resolves the target issue number from an issue event payload or manual workflow input.
 */
export function getIssueNumber(context: Context, issueNumberInput?: string): number {
  const payloadIssue = context.payload.issue as { number?: number } | undefined;
  if (payloadIssue?.number) {
    return payloadIssue.number;
  }

  const issueNumber = Number(issueNumberInput);
  if (Number.isInteger(issueNumber) && issueNumber > 0) {
    return issueNumber;
  }

  throw new Error("issue_number input is required for non-issue events");
}

/**
 * Loads the GitHub issue that all automation phases operate on.
 */
export async function loadIssue(octokit: Octokit, context: Context, issueNumberInput?: string): Promise<Issue> {
  const issueNumber = getIssueNumber(context, issueNumberInput);
  const { data } = await octokit.rest.issues.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
  });

  return data as Issue;
}

/**
 * Lists every parent issue comment so marker-based updates do not miss older pages.
 */
export async function listIssueComments(
  octokit: Octokit,
  context: Context,
  issue: Issue,
): Promise<IssueComment[]> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issue.number,
    per_page: 100,
  });

  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    html_url: comment.html_url,
  }));
}

/**
 * Updates an existing marker comment or creates a new comment when no marker exists.
 */
export async function upsertComment(
  octokit: Octokit,
  context: Context,
  issue: Issue,
  marker: string,
  body: string,
): Promise<void> {
  const comments = await listIssueComments(octokit, context, issue);
  const existing = comments.find((comment) => comment.body?.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
    return;
  }

  await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issue.number,
    body,
  });
}

/**
 * Creates a new parent issue comment for phase results and dependency issue notices.
 */
export async function createComment(
  octokit: Octokit,
  context: Context,
  issue: Issue,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issue.number,
    body,
  });
}
