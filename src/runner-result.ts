import fs from "fs";
import path from "path";

import type { AutomationConfig, AutomationState, Issue, RunnerResult } from "./types";
import { normalizeBodyText, normalizeTitle } from "./rules";

/**
 * Returns the runtime issue context path from the normalized repository config.
 */
export function issueContextPath(config: AutomationConfig): string {
  return path.join(config.runtime.dir, config.runtime.issueContextFile);
}

/**
 * Returns the runner-result path that Claude Code Action must write.
 */
export function runnerResultPath(config: AutomationConfig): string {
  return path.join(config.runtime.dir, config.runtime.runnerResultFile);
}

/**
 * Writes the issue context Markdown file consumed by Claude Code Action.
 */
export function writeIssueContext(params: {
  config: AutomationConfig;
  repoFullName: string;
  issue: Issue;
  state: AutomationState;
  agentContractPath: string;
}): void {
  const contextPath = issueContextPath(params.config);
  fs.mkdirSync(path.dirname(contextPath), { recursive: true });

  const body = [
    "# Issue Context",
    "",
    `Repository: ${params.repoFullName}`,
    `Issue: #${params.issue.number}`,
    `Title: ${params.issue.title}`,
    `URL: ${params.issue.html_url}`,
    `Automation status: ${params.state.status}`,
    `Kind: ${params.state.kind ?? "none"}`,
    `Area: ${params.state.area ?? "none"}`,
    `Dependencies: ${params.state.dependencies.join(", ") || "none"}`,
    `Maintainer needed: ${params.state.maintainerNeeded ? "yes" : "no"}`,
    "",
    "## Body",
    "",
    params.issue.body || "_No body provided._",
    "",
    "## Agent Contract",
    "",
    `Follow \`${params.agentContractPath}\`.`,
    "",
    "If repository changes are needed, edit files directly.",
    `If repository changes are made, write result JSON to \`${runnerResultPath(params.config)}\`.`,
  ].join("\n");

  fs.writeFileSync(contextPath, body);
}

/**
 * Reads runner-result JSON and converts parse failures into a maintainer-needed result.
 */
export function readRunnerResult(config: AutomationConfig): RunnerResult | null {
  const resultPath = runnerResultPath(config);
  if (!fs.existsSync(resultPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8")) as RunnerResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      action: "needs_maintainer",
      summary: `runner-result.json 파싱 실패: ${message}`,
    };
  }
}

/**
 * Extracts configured dependency issue keys from current and legacy runner-result fields.
 */
export function dependencyKeysFromResult(config: AutomationConfig, result: RunnerResult | null): string[] {
  if (!result) {
    return [];
  }

  const keys = new Set<string>();
  for (const key of result.needsIssues ?? []) {
    keys.add(key);
  }

  if (result.action?.startsWith("needs_")) {
    keys.add(result.action.replace(/^needs_/, ""));
  }

  if (result.needsCliIssue) {
    keys.add("cli");
  }
  if (result.needsDbtIssue) {
    keys.add("dbt");
  }

  const configuredKeys = new Set(config.dependencies.map((dependency) => dependency.key));
  return [...keys].filter((key) => configuredKeys.has(key));
}

/**
 * Resolves the commit message from runner-result JSON or a deterministic issue fallback.
 */
export function commitMessage(config: AutomationConfig, issue: Issue): string {
  const result = readRunnerResult(config);
  const explicitMessage = normalizeTitle(result?.commit_message ?? result?.commitMessage ?? result?.commit);

  return explicitMessage || `fix: 이슈 #${issue.number} 변경 사항 반영`;
}

/**
 * Resolves the pull request title from runner-result JSON or a deterministic issue fallback.
 */
export function pullRequestTitle(config: AutomationConfig, issue: Issue): string {
  const result = readRunnerResult(config);
  const explicitTitle = normalizeTitle(result?.pr_title ?? result?.prTitle ?? result?.title);

  return explicitTitle || `이슈 #${issue.number} 변경 사항 반영`;
}

/**
 * Builds the pull request body from runner-result JSON and configured dependency keys.
 */
export function pullRequestBody(config: AutomationConfig, issue: Issue): string {
  const result = readRunnerResult(config) ?? {};
  const needsIssueKeys = dependencyKeysFromResult(config, result);
  const plannedChanges = Array.isArray(result.plannedChanges)
    ? result.plannedChanges
    : Array.isArray(result.changes)
      ? result.changes
      : [];

  const sections = [
    `Fixes #${issue.number}`,
    "",
    "## 문제",
    "",
    normalizeBodyText(result.problem ?? result.issue ?? result.summary, `이 PR은 #${issue.number} 이슈에서 제기된 문제를 처리합니다.`),
    "",
    "## 원인 분석",
    "",
    normalizeBodyText(
      result.root_cause ?? result.rootCause ?? result.cause ?? result.reason,
      "원인 분석은 runner 결과에 명시되지 않았습니다. 변경 diff와 연결된 issue를 함께 확인해야 합니다.",
    ),
    "",
    "## 해결 방법",
    "",
    normalizeBodyText(result.solution ?? result.fix ?? result.summary, "Repository 변경으로 이슈에서 요구한 동작을 반영했습니다."),
  ];

  if (plannedChanges.length > 0) {
    sections.push("", "## 변경 사항", "", ...plannedChanges.map((item) => `- ${item}`));
  }

  if (needsIssueKeys.length > 0) {
    sections.push(
      "",
      "## 후속 작업",
      "",
      ...needsIssueKeys.map((key) => `- \`${key}\` dependency issue 생성 또는 확인이 필요합니다.`),
    );
  }

  sections.push(
    "",
    "## 검증",
    "",
    normalizeBodyText(
      result.validation ?? result.verification,
      "자동 runner 정책에 따라 테스트, self-test, lint, package install은 실행하지 않았습니다.",
    ),
  );

  return sections.join("\n");
}
