import * as core from "@actions/core";
import * as github from "@actions/github";

import { loadConfig } from "./config";
import { optionalBooleanInput } from "./inputs";
import { runPhase } from "./phases";
import type { ActionInputs, Phase } from "./types";

const PHASES: readonly Phase[] = [
  "intake",
  "prepare",
  "prepare_pr_metadata",
  "finalize_pr",
  "finalize_no_changes",
  "finalize_failure",
  "finalize_claude_action_failure",
];

/**
 * GitHub Action entrypoint that loads user inputs, repository config, and GitHub API client.
 */
async function main(): Promise<void> {
  const inputs = readInputs();
  const token = core.getInput("github_token", { required: true });
  const octokit = github.getOctokit(token);
  const config = loadConfig(inputs.configPath);

  await runPhase({
    core,
    octokit,
    context: github.context,
    config,
    inputs,
  });
}

/**
 * Reads and normalizes GitHub Action inputs before a phase handler uses them.
 */
function readInputs(): ActionInputs {
  return {
    phase: parsePhase(core.getInput("phase", { required: true })),
    issueNumber: optionalInput("issue_number"),
    forceAi: optionalBooleanInput(core, "force_ai"),
    configPath: core.getInput("config_path") || ".github/issue-automation.yml",
    agentContractPath: core.getInput("agent_contract_path") || ".github/ai/issue-agent-contract.md",
    prUrl: optionalInput("pr_url"),
    failureReason: optionalInput("failure_reason"),
  };
}

/**
 * Rejects unsupported phase names so a workflow typo fails before mutating issues.
 */
function parsePhase(value: string): Phase {
  if ((PHASES as readonly string[]).includes(value)) {
    return value as Phase;
  }

  throw new Error(`Unsupported phase: ${value}`);
}

/**
 * Converts blank action inputs into undefined while preserving non-empty values.
 */
function optionalInput(name: string): string | undefined {
  const value = core.getInput(name);
  return value ? value : undefined;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
