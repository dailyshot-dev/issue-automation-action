import type { Context } from "@actions/github/lib/context";
import type * as core from "@actions/core";

import type { ActionInputs, AutomationConfig, AutomationState, DependencyConfig, DependencyIssueResult, Issue } from "./types";
import type { Octokit } from "./github";
import { createComment, loadIssue } from "./github";
import { createDependencyIssue } from "./dependency-issues";
import { classifyByRules, issueText, matchesAny, slugify } from "./rules";
import {
  commitMessage,
  dependencyKeysFromResult,
  issueContextPath,
  pullRequestBody,
  pullRequestTitle,
  readRunnerResult,
  runnerResultPath,
  writeIssueContext,
} from "./runner-result";
import {
  defaultAutomationState,
  readAutomationState,
  statusFromRunnerAction,
  upsertAutomationState,
  withDependencyKeys,
} from "./state";

/**
 * Dispatches a single action phase. Each phase owns one issue automation state transition.
 */
export async function runPhase(params: {
  core: typeof core;
  octokit: Octokit;
  context: Context;
  config: AutomationConfig;
  inputs: ActionInputs;
}): Promise<void> {
  switch (params.inputs.phase) {
    case "intake":
      await intake(params);
      return;
    case "prepare":
      await prepare(params);
      return;
    case "prepare_pr_metadata":
      await preparePullRequestMetadata(params);
      return;
    case "finalize_pr":
      await finalizePr(params);
      return;
    case "finalize_no_changes":
      await finalizeNoChanges(params);
      return;
    case "finalize_failure":
      await finalizeFailure(params);
      return;
    case "finalize_claude_action_failure":
      await finalizeClaudeActionFailure(params);
      return;
  }
}

async function intake(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);
  const previousState = await readStateOrDefault(params, issue);
  const classification = classifyIssue(params.config, issue);
  const dependencyMatches = dependencyMatchMap(params.config.dependencies, classification.text);
  const autoCreateDependencies = params.config.dependencies.filter((dependency) => (
    dependency.autoCreate && dependencyMatches.get(dependency.key)
  ));
  const dependencyResults = await createDependencyIssues(params, issue, autoCreateDependencies);
  const dependencyKeys = autoCreateDependencies.map((dependency) => dependency.key);
  const hasDependencyError = dependencyResults.some((dependencyResult) => dependencyResult.error);
  const status = intakeStatus(previousState, classification.maintainerNeeded, hasDependencyError);

  const nextState = withDependencyKeys({
    ...previousState,
    status,
    kind: classification.kind,
    area: classification.area,
    maintainerNeeded: status === "needs_maintainer",
    summary: "Issue intake가 완료됐습니다.",
  }, dependencyKeys);

  await upsertAutomationState({
    octokit: params.octokit,
    context: params.context,
    issue,
    state: nextState,
    dependencyResults,
  });
}

async function prepare(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);
  const state = await readStateOrDefault(params, issue);
  const shouldRun = canRunClaude(state, params.inputs.forceAi);
  const branch = `ai/issue-${issue.number}-${slugify(issue.title)}`;

  params.core.setOutput("issue_number", String(issue.number));
  params.core.setOutput("branch", branch);

  if (!shouldRun) {
    params.core.setOutput("should_run", "false");
    return;
  }

  const nextState = {
    ...state,
    status: "working" as const,
    branch,
    summary: "Claude runner 실행을 준비했습니다.",
  };
  await upsertAutomationState({
    octokit: params.octokit,
    context: params.context,
    issue,
    state: nextState,
  });

  writeIssueContext({
    config: params.config,
    repoFullName: `${params.context.repo.owner}/${params.context.repo.repo}`,
    issue,
    state: nextState,
    agentContractPath: params.inputs.agentContractPath,
  });

  params.core.setOutput("should_run", "true");
  params.core.setOutput("issue_context_path", issueContextPath(params.config));
  params.core.setOutput("runner_result_path", runnerResultPath(params.config));
}

async function preparePullRequestMetadata(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);

  params.core.setOutput("commit_message", commitMessage(params.config, issue));
  params.core.setOutput("pr_title", pullRequestTitle(params.config, issue));
  params.core.setOutput("pr_body", pullRequestBody(params.config, issue));
}

async function finalizeNoChanges(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);
  const previousState = await readStateOrDefault(params, issue);
  const result = readRunnerResult(params.config);
  const action = result?.action || "needs_maintainer";
  const dependencyKeys = dependencyKeysFromResult(params.config, result);
  const dependencyResults = action === "needs_info" || action === "no_changes"
    ? []
    : await createDependencyIssuesByKeys(params, issue, dependencyKeys);
  const hasDependencyError = dependencyResults.some((dependencyResult) => dependencyResult.error);
  const status = hasDependencyError ? "needs_maintainer" : statusFromRunnerAction(action, dependencyKeys);
  const nextState = withDependencyKeys({
    ...previousState,
    status,
    maintainerNeeded: status === "needs_maintainer",
    summary: result?.summary || "Claude runner가 repository 변경을 만들지 않았습니다.",
  }, dependencyKeys);

  await upsertAutomationState({
    octokit: params.octokit,
    context: params.context,
    issue,
    state: nextState,
    dependencyResults,
  });
  await createComment(
    params.octokit,
    params.context,
    issue,
    [
      "<!-- dailyshot-claude-runner -->",
      "## Claude runner result",
      "",
      `- action: \`${action}\``,
      `- status: \`${nextState.status}\``,
      `- summary: ${nextState.summary}`,
      ...dependencyResultLines(dependencyResults),
      "",
      "PR이 생성되지 않았습니다.",
    ].join("\n"),
  );
}

async function finalizeFailure(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);
  const previousState = await readStateOrDefault(params, issue);
  const failureReason = params.inputs.failureReason || "Claude runner 실행 또는 PR 생성 orchestration이 실패했습니다.";
  const nextState = {
    ...previousState,
    status: "needs_maintainer" as const,
    maintainerNeeded: true,
    failureReason,
    summary: "maintainer 확인이 필요합니다.",
  };

  await upsertAutomationState({
    octokit: params.octokit,
    context: params.context,
    issue,
    state: nextState,
  });
  await createComment(
    params.octokit,
    params.context,
    issue,
    [
      "<!-- dailyshot-claude-runner -->",
      "## Claude runner failed",
      "",
      failureReason,
      "",
      "maintainer 확인이 필요합니다.",
    ].join("\n"),
  );
}

async function finalizeClaudeActionFailure(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);
  const previousState = await readStateOrDefault(params, issue);
  const failureReason = params.inputs.failureReason || "Claude Code Action 실행 준비에 실패했습니다.";
  const nextState = {
    ...previousState,
    status: "needs_maintainer" as const,
    maintainerNeeded: true,
    failureReason,
    summary: "Claude Code Action 실행 준비에 실패했습니다.",
  };

  await upsertAutomationState({
    octokit: params.octokit,
    context: params.context,
    issue,
    state: nextState,
  });
  await createComment(
    params.octokit,
    params.context,
    issue,
    [
      "<!-- dailyshot-claude-action-failed -->",
      "## Claude Code Action failed",
      "",
      failureReason,
      "",
      "`CLAUDE_CODE_OAUTH_TOKEN` secret을 설정한 뒤 workflow를 다시 실행하세요.",
    ].join("\n"),
  );
}

async function finalizePr(params: PhaseParams): Promise<void> {
  const issue = await loadIssue(params.octokit, params.context, params.inputs.issueNumber);
  const previousState = await readStateOrDefault(params, issue);
  const result = readRunnerResult(params.config);
  const dependencyKeys = dependencyKeysFromResult(params.config, result);
  const dependencyResults = await createDependencyIssuesByKeys(params, issue, dependencyKeys);
  const hasDependencyError = dependencyResults.some((dependencyResult) => dependencyResult.error);
  const status = hasDependencyError ? "needs_maintainer" : "pr_created";
  const nextState = withDependencyKeys({
    ...previousState,
    status,
    maintainerNeeded: hasDependencyError,
    prUrl: params.inputs.prUrl,
    summary: result?.summary || "Claude runner가 PR을 생성했습니다.",
  }, dependencyKeys);

  await upsertAutomationState({
    octokit: params.octokit,
    context: params.context,
    issue,
    state: nextState,
    dependencyResults,
  });
  await createComment(
    params.octokit,
    params.context,
    issue,
    [
      "<!-- dailyshot-claude-runner -->",
      "## Claude runner created a PR",
      "",
      `PR: ${params.inputs.prUrl || "_PR URL not provided_"}`,
      ...dependencyResultLines(dependencyResults),
      "",
      "maintainer review와 merge를 기다립니다.",
    ].join("\n"),
  );
}

async function readStateOrDefault(params: PhaseParams, issue: Issue): Promise<AutomationState> {
  const state = await readAutomationState(params.octokit, params.context, issue);
  if (state) {
    return state;
  }

  const classification = classifyIssue(params.config, issue);
  return defaultAutomationState({
    status: classification.maintainerNeeded ? "needs_maintainer" : "triage",
    kind: classification.kind,
    area: classification.area,
    maintainerNeeded: classification.maintainerNeeded,
  });
}

async function createDependencyIssuesByKeys(
  params: PhaseParams,
  issue: Issue,
  dependencyKeys: string[],
): Promise<DependencyIssueResult[]> {
  const keySet = new Set(dependencyKeys);
  const dependencies = params.config.dependencies.filter((dependency) => keySet.has(dependency.key));

  return createDependencyIssues(params, issue, dependencies);
}

async function createDependencyIssues(
  params: PhaseParams,
  issue: Issue,
  dependencies: DependencyConfig[],
): Promise<DependencyIssueResult[]> {
  const results: DependencyIssueResult[] = [];
  for (const dependency of dependencies) {
    results.push(await createDependencyIssue({
      octokit: params.octokit,
      context: params.context,
      issue,
      dependency,
    }));
  }

  return results;
}

function classifyIssue(config: AutomationConfig, issue: Issue): {
  text: string;
  kind: string | null;
  area: string | null;
  maintainerNeeded: boolean;
} {
  const text = issueText(issue);
  return {
    text,
    kind: classifyByRules(text, config.kindRules, config.defaultKind),
    area: classifyByRules(text, config.areaRules, null),
    maintainerNeeded: matchesAny(text, config.maintainerPatterns),
  };
}

function canRunClaude(state: AutomationState, forceAi: boolean): boolean {
  if (state.status === "needs_maintainer" || state.status === "needs_info" || state.status === "pr_created") {
    return false;
  }

  return forceAi || state.status === "triage";
}

function intakeStatus(
  previousState: AutomationState,
  maintainerNeeded: boolean,
  dependencyIssueCreationFailed: boolean,
): AutomationState["status"] {
  if (maintainerNeeded || dependencyIssueCreationFailed) {
    return "needs_maintainer";
  }

  return previousState.status;
}

function dependencyMatchMap(dependencies: DependencyConfig[], text: string): Map<string, boolean> {
  return new Map(dependencies.map((dependency) => [dependency.key, matchesAny(text, dependency.patterns)]));
}

function dependencyResultLines(results: DependencyIssueResult[]): string[] {
  return results.flatMap((result) => {
    if (result.url) {
      return [`- ${result.key} issue: ${result.url}`];
    }
    if (result.error) {
      return [`- ${result.key} issue creation error: ${result.error}`];
    }
    if (result.alreadyExists && result.comment) {
      return [`- ${result.key} issue already exists: ${result.comment}`];
    }

    return [];
  });
}

type PhaseParams = {
  core: typeof core;
  octokit: Octokit;
  context: Context;
  config: AutomationConfig;
  inputs: ActionInputs;
};
