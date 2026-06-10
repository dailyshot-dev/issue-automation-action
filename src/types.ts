export type Phase =
  | "intake"
  | "prepare"
  | "prepare_pr_metadata"
  | "finalize_pr"
  | "finalize_no_changes"
  | "finalize_failure"
  | "finalize_claude_action_failure";

export interface RuleConfig {
  value: string;
  patterns: string[];
}

export interface DependencyConfig {
  key: string;
  owner: string;
  repo: string;
  marker: string;
  patterns: string[];
  autoCreate: boolean;
  bodyNotes: string[];
  titlePrefix: string;
}

export interface RuntimeConfig {
  dir: string;
  issueContextFile: string;
  runnerResultFile: string;
}

export interface AutomationConfig {
  runtime: RuntimeConfig;
  kindRules: RuleConfig[];
  defaultKind: string;
  areaRules: RuleConfig[];
  maintainerPatterns: string[];
  dependencies: DependencyConfig[];
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
}

export interface IssueComment {
  id: number;
  body?: string | null;
  html_url: string;
}

export interface RunnerResult {
  action?: string;
  commit_message?: string;
  commitMessage?: string;
  commit?: string;
  pr_title?: string;
  prTitle?: string;
  title?: string;
  problem?: string;
  issue?: string;
  root_cause?: string;
  rootCause?: string;
  cause?: string;
  reason?: string;
  solution?: string;
  fix?: string;
  validation?: string;
  verification?: string;
  summary?: string;
  plannedChanges?: string[];
  changes?: string[];
  needsIssues?: string[];
  needsCliIssue?: boolean;
  needsDbtIssue?: boolean;
  needsMaintainer?: boolean;
}

export interface ActionInputs {
  phase: Phase;
  issueNumber?: string;
  forceAi: boolean;
  configPath: string;
  agentContractPath: string;
  prUrl?: string;
  failureReason?: string;
}

export interface RenderContext {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  parentUrl: string;
}

export interface DependencyIssueResult {
  key: string;
  url?: string;
  comment?: string;
  alreadyExists?: boolean;
  error?: string;
}

export type AutomationStatus =
  | "triage"
  | "working"
  | "pr_created"
  | "needs_info"
  | "needs_maintainer"
  | "needs_dependency"
  | "no_changes";

export interface AutomationState {
  version: 1;
  status: AutomationStatus;
  kind: string | null;
  area: string | null;
  dependencies: string[];
  maintainerNeeded: boolean;
  branch?: string;
  prUrl?: string;
  summary?: string;
  failureReason?: string;
}
