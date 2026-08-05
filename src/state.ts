import type { Context } from "@actions/github/lib/context";

import type { Octokit } from "./github";
import { addIssueLabels, listIssueComments, upsertComment } from "./github";
import type { AutomationState, AutomationStatus, DependencyIssueResult, Issue } from "./types";

export const STATE_MARKER = "<!-- dailyshot-issue-automation-state";

/**
 * Reads the automation state stored in the parent issue marker comment.
 */
export async function readAutomationState(
  octokit: Octokit,
  context: Context,
  issue: Issue,
): Promise<AutomationState | null> {
  const comments = await listIssueComments(octokit, context, issue);
  const comment = comments.find((issueComment) => issueComment.body?.includes(STATE_MARKER));
  if (!comment?.body) {
    return null;
  }

  return parseAutomationState(comment.body);
}

/**
 * Writes the automation state as the single source of truth for issue automation.
 */
export async function upsertAutomationState(params: {
  octokit: Octokit;
  context: Context;
  issue: Issue;
  state: AutomationState;
  dependencyResults?: DependencyIssueResult[];
}): Promise<void> {
  await upsertComment(
    params.octokit,
    params.context,
    params.issue,
    STATE_MARKER,
    renderAutomationState(params.state, params.dependencyResults ?? []),
  );
  await addIssueLabels(params.octokit, params.context, params.issue, labelsForState(params.state));
}

/**
 * Derives the GitHub labels that should be present for a given automation state.
 * kind/area reflect classification, ai:triage marks AI-processed issues, and the
 * needs:* label mirrors the status that currently blocks automated progress.
 */
export function labelsForState(state: AutomationState): string[] {
  const labels = ["ai:triage"];

  if (state.kind) {
    labels.push(`kind:${state.kind}`);
  }
  if (state.area) {
    labels.push(`area:${state.area}`);
  }
  if (state.maintainerNeeded) {
    labels.push("needs:maintainer");
  }
  if (state.status === "needs_info") {
    labels.push("needs:info");
  }
  if (state.status === "needs_dependency") {
    labels.push("needs:dependency");
  }

  return labels;
}

/**
 * Creates a normalized state object for issues that have no state comment yet.
 */
export function defaultAutomationState(params?: Partial<AutomationState>): AutomationState {
  return {
    version: 1,
    status: params?.status ?? "triage",
    kind: params?.kind ?? null,
    area: params?.area ?? null,
    dependencies: params?.dependencies ?? [],
    maintainerNeeded: params?.maintainerNeeded ?? false,
    branch: params?.branch,
    prUrl: params?.prUrl,
    summary: params?.summary,
    failureReason: params?.failureReason,
  };
}

/**
 * Returns a copy of the state with unique dependency keys appended in order.
 */
export function withDependencyKeys(state: AutomationState, dependencyKeys: string[]): AutomationState {
  return {
    ...state,
    dependencies: [...new Set([...state.dependencies, ...dependencyKeys])],
  };
}

/**
 * Maps runner-result actions into comment-state statuses.
 */
export function statusFromRunnerAction(action: string, dependencyKeys: string[]): AutomationStatus {
  if (action === "needs_info") {
    return "needs_info";
  }
  if (action === "no_changes") {
    return "no_changes";
  }
  if (dependencyKeys.length > 0) {
    return "needs_dependency";
  }

  return "needs_maintainer";
}

/**
 * Renders hidden JSON state and a compact human-readable summary in one issue comment.
 */
export function renderAutomationState(
  state: AutomationState,
  dependencyResults: DependencyIssueResult[] = [],
): string {
  return [
    STATE_MARKER,
    stringifyStateForComment(state),
    "-->",
    "## AI issue automation",
    "",
    `- status: \`${state.status}\``,
    `- kind: ${state.kind ? `\`${state.kind}\`` : "_not detected_"}`,
    `- area: ${state.area ? `\`${state.area}\`` : "_not detected_"}`,
    `- dependencies: ${state.dependencies.length > 0 ? state.dependencies.map((key) => `\`${key}\``).join(", ") : "_none_"}`,
    `- maintainer needed: ${state.maintainerNeeded ? "yes" : "no"}`,
    ...optionalLine("branch", state.branch),
    ...optionalLine("PR", state.prUrl),
    ...optionalLine("summary", state.summary),
    ...optionalLine("failure", state.failureReason),
    ...dependencyResultLines(dependencyResults),
  ].join("\n");
}

function parseAutomationState(body: string): AutomationState | null {
  const markerStart = body.indexOf(STATE_MARKER);
  if (markerStart < 0) {
    return null;
  }

  const jsonStart = markerStart + STATE_MARKER.length;
  const jsonEnd = body.indexOf("-->", jsonStart);
  if (jsonEnd < 0) {
    return defaultAutomationState({
      status: "needs_maintainer",
      maintainerNeeded: true,
      failureReason: "Automation state comment marker is not closed.",
    });
  }

  try {
    return normalizeParsedState(JSON.parse(body.slice(jsonStart, jsonEnd).trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return defaultAutomationState({
      status: "needs_maintainer",
      maintainerNeeded: true,
      failureReason: `Automation state JSON parse failed: ${message}`,
    });
  }
}

function stringifyStateForComment(state: AutomationState): string {
  return JSON.stringify(state, null, 2).replaceAll("--", "-\\u002d");
}

function normalizeParsedState(value: unknown): AutomationState {
  if (typeof value !== "object" || value === null) {
    return defaultAutomationState({
      status: "needs_maintainer",
      maintainerNeeded: true,
      failureReason: "Automation state JSON must be an object.",
    });
  }

  const raw = value as Partial<AutomationState>;
  return defaultAutomationState({
    version: 1,
    status: isAutomationStatus(raw.status) ? raw.status : "triage",
    kind: typeof raw.kind === "string" ? raw.kind : null,
    area: typeof raw.area === "string" ? raw.area : null,
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies.filter((dependencyKey): dependencyKey is string => typeof dependencyKey === "string")
      : [],
    maintainerNeeded: raw.maintainerNeeded === true,
    branch: typeof raw.branch === "string" ? raw.branch : undefined,
    prUrl: typeof raw.prUrl === "string" ? raw.prUrl : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    failureReason: typeof raw.failureReason === "string" ? raw.failureReason : undefined,
  });
}

function isAutomationStatus(value: unknown): value is AutomationStatus {
  return value === "triage"
    || value === "working"
    || value === "pr_created"
    || value === "needs_info"
    || value === "needs_maintainer"
    || value === "needs_dependency"
    || value === "no_changes";
}

function optionalLine(name: string, value: string | undefined): string[] {
  return value ? [`- ${name}: ${value}`] : [];
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
