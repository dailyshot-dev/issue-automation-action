import type { Context } from "@actions/github/lib/context";

import type { Octokit } from "./github";
import type { DependencyConfig, DependencyIssueResult, Issue, RenderContext } from "./types";
import { createComment, listIssueComments } from "./github";
import { renderTemplate } from "./rules";

/**
 * Creates a configured dependency issue and records the result on the parent issue.
 */
export async function createDependencyIssue(params: {
  octokit: Octokit;
  context: Context;
  issue: Issue;
  dependency: DependencyConfig;
}): Promise<DependencyIssueResult> {
  const existing = await findMarkerComment(params);
  if (existing) {
    return {
      key: params.dependency.key,
      alreadyExists: true,
      comment: existing.html_url,
    };
  }

  try {
    const dependencyIssue = await createTargetIssue(params);
    const relationNote = await linkSubIssue({
      ...params,
      subIssueId: dependencyIssue.id,
    });

    await createComment(
      params.octokit,
      params.context,
      params.issue,
      [
        params.dependency.marker,
        `\`${params.dependency.repo}\` 작업이 필요하다고 판단해 dependency issue를 생성했습니다: ${dependencyIssue.html_url}`,
        relationNote,
      ].join("\n"),
    );

    return {
      key: params.dependency.key,
      url: dependencyIssue.html_url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await createComment(
      params.octokit,
      params.context,
      params.issue,
      [
        params.dependency.marker,
        `\`${params.dependency.repo}\` 작업이 필요하다고 판단했지만 dependency issue 생성에 실패했습니다.`,
        "",
        `원인: ${message}`,
        "",
        "maintainer 확인이 필요합니다.",
      ].join("\n"),
    );

    return {
      key: params.dependency.key,
      error: message,
    };
  }
}

async function findMarkerComment(params: {
  octokit: Octokit;
  context: Context;
  issue: Issue;
  dependency: DependencyConfig;
}): Promise<{ html_url: string } | null> {
  const comments = await listIssueComments(params.octokit, params.context, params.issue);

  return comments.find((comment) => comment.body?.includes(params.dependency.marker)) ?? null;
}

async function createTargetIssue(params: {
  octokit: Octokit;
  context: Context;
  issue: Issue;
  dependency: DependencyConfig;
}): Promise<{ id: number; html_url: string }> {
  const renderContext = renderContextOf(params.context, params.issue);
  const titlePrefix = renderTemplate(params.dependency.titlePrefix, renderContext);
  const body = dependencyIssueBody(params.dependency, params.issue);

  const { data } = await params.octokit.rest.issues.create({
    owner: params.dependency.owner,
    repo: params.dependency.repo,
    title: `${titlePrefix} ${params.issue.title}`,
    body,
  });

  return {
    id: data.id,
    html_url: data.html_url,
  };
}

async function linkSubIssue(params: {
  octokit: Octokit;
  context: Context;
  issue: Issue;
  subIssueId: number;
}): Promise<string> {
  try {
    await params.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
      owner: params.context.repo.owner,
      repo: params.context.repo.repo,
      issue_number: params.issue.number,
      sub_issue_id: params.subIssueId,
      headers: {
        "X-GitHub-Api-Version": "2026-03-10",
      },
    });

    return "\n\nParent issue에 sub-issue 관계도 연결했습니다.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `\n\nsub-issue 관계 연결은 실패했습니다. 원인: ${message}`;
  }
}

function dependencyIssueBody(dependency: DependencyConfig, issue: Issue): string {
  return [
    "이 issue는 issue automation workflow에서 자동 생성됐습니다.",
    "",
    `Parent issue: ${issue.html_url}`,
    "",
    "## 요청 배경",
    "",
    issue.body || "_No body provided._",
    "",
    "## 처리 기준",
    "",
    ...dependency.bodyNotes.map((note) => `- ${note}`),
  ].join("\n");
}

function renderContextOf(context: Context, issue: Issue): RenderContext {
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issueNumber: issue.number,
    issueTitle: issue.title,
    parentUrl: issue.html_url,
  };
}
