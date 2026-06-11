import fs from "fs";
import path from "path";
import YAML from "yaml";

import type { AutomationConfig, DependencyConfig, RuleConfig } from "./types";

interface RawRuleConfig {
  value?: string;
  patterns?: string[];
}

interface RawDependencyConfig {
  key?: string;
  owner?: string;
  repo?: string;
  marker?: string;
  patterns?: string[];
  auto_create?: boolean;
  autoCreate?: boolean;
  body_notes?: string[];
  bodyNotes?: string[];
  title_prefix?: string;
  titlePrefix?: string;
}

interface RawRuntimeConfig {
  dir?: string;
  issue_context_file?: string;
  issueContextFile?: string;
  runner_result_file?: string;
  runnerResultFile?: string;
}

interface RawAutomationConfig {
  runtime?: RawRuntimeConfig;
  kind_rules?: RawRuleConfig[];
  kindRules?: RawRuleConfig[];
  default_kind?: string;
  defaultKind?: string;
  area_rules?: RawRuleConfig[];
  areaRules?: RawRuleConfig[];
  maintainer_patterns?: string[];
  maintainerPatterns?: string[];
  dependencies?: RawDependencyConfig[];
}

const DEFAULT_CONFIG: AutomationConfig = {
  runtime: {
    dir: ".github/ai/runtime",
    issueContextFile: "issue-context.md",
    runnerResultFile: "runner-result.json",
  },
  kindRules: [],
  defaultKind: "task",
  areaRules: [],
  maintainerPatterns: [],
  dependencies: [],
};

/**
 * Loads a repository-local automation config or returns safe defaults when it is absent.
 */
export function loadConfig(configPath: string): AutomationConfig {
  if (!fs.existsSync(configPath)) {
    return withRuntimeDirOverride(DEFAULT_CONFIG);
  }

  const rawText = fs.readFileSync(configPath, "utf8");
  const raw = parseConfig(rawText, configPath);

  return withRuntimeDirOverride(normalizeConfig(raw));
}

function parseConfig(rawText: string, configPath: string): RawAutomationConfig {
  if (configPath.endsWith(".json")) {
    return JSON.parse(rawText) as RawAutomationConfig;
  }

  return YAML.parse(rawText) as RawAutomationConfig;
}

function normalizeConfig(raw: RawAutomationConfig): AutomationConfig {
  const runtime = raw.runtime ?? {};

  return {
    runtime: {
      dir: runtime.dir ?? DEFAULT_CONFIG.runtime.dir,
      issueContextFile:
        runtime.issue_context_file ?? runtime.issueContextFile ?? DEFAULT_CONFIG.runtime.issueContextFile,
      runnerResultFile:
        runtime.runner_result_file ?? runtime.runnerResultFile ?? DEFAULT_CONFIG.runtime.runnerResultFile,
    },
    kindRules: normalizeRules(raw.kind_rules ?? raw.kindRules ?? DEFAULT_CONFIG.kindRules, "kind_rules"),
    defaultKind: raw.default_kind ?? raw.defaultKind ?? DEFAULT_CONFIG.defaultKind,
    areaRules: normalizeRules(raw.area_rules ?? raw.areaRules ?? DEFAULT_CONFIG.areaRules, "area_rules"),
    maintainerPatterns: raw.maintainer_patterns ?? raw.maintainerPatterns ?? DEFAULT_CONFIG.maintainerPatterns,
    dependencies: normalizeDependencies(raw.dependencies ?? []),
  };
}

function withRuntimeDirOverride(config: AutomationConfig): AutomationConfig {
  const runtimeDir = runtimeDirOverride();
  if (!runtimeDir) {
    return config;
  }

  return {
    ...config,
    runtime: {
      ...config.runtime,
      dir: runtimeDir,
    },
  };
}

function runtimeDirOverride(): string | undefined {
  if (process.env.ISSUE_AUTOMATION_RUNTIME_DIR) {
    return process.env.ISSUE_AUTOMATION_RUNTIME_DIR;
  }

  if (process.env.RUNNER_TEMP) {
    return path.join(process.env.RUNNER_TEMP, "issue-automation");
  }

  return undefined;
}

function normalizeRules(rules: RawRuleConfig[], fieldName: string): RuleConfig[] {
  return rules.map((rule, index) => ({
    value: requiredString(rule.value, `${fieldName}[${index}].value`),
    patterns: rule.patterns ?? [],
  }));
}

function normalizeDependencies(dependencies: RawDependencyConfig[]): DependencyConfig[] {
  return dependencies.map((dependency) => ({
    key: requiredString(dependency.key, "dependencies[].key"),
    owner: requiredString(dependency.owner, "dependencies[].owner"),
    repo: requiredString(dependency.repo, "dependencies[].repo"),
    marker: requiredString(dependency.marker, "dependencies[].marker"),
    patterns: dependency.patterns ?? [],
    autoCreate: dependency.auto_create ?? dependency.autoCreate ?? false,
    bodyNotes: dependency.body_notes ?? dependency.bodyNotes ?? [],
    titlePrefix: dependency.title_prefix ?? dependency.titlePrefix ?? "[{repo} #{issue_number}]",
  }));
}

function requiredString(value: string | undefined, fieldName: string): string {
  if (value) {
    return value;
  }

  throw new Error(`${fieldName} is required`);
}
