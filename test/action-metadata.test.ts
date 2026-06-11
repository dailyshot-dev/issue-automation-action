import fs from "fs";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

describe("action metadata", () => {
  it("passes required inputs to every bundled phase runner invocation", () => {
    const action = YAML.parse(fs.readFileSync("action.yml", "utf8")) as {
      runs: {
        steps: Array<{
          name?: string;
          run?: string;
          env?: Record<string, string>;
        }>;
      };
    };

    const phaseRunnerSteps = action.runs.steps.filter((step) => step.run?.includes("dist/index.js"));

    expect(phaseRunnerSteps.map((step) => step.name)).toEqual([
      "Classify and route issue",
      "Prepare Claude runner",
      "Finalize missing Claude token",
      "Prepare pull request metadata",
      "Finalize PR result",
      "Finalize no-change result",
      "Finalize Claude runner failure",
      "Finalize workflow failure",
    ]);
    for (const step of phaseRunnerSteps) {
      expect(step.env?.INPUT_FORCE_AI).toBe("${{ inputs.force_ai }}");
      expect(step.env?.INPUT_CONFIG_PATH).toBe("${{ inputs.config_path }}");
      expect(step.env?.INPUT_AGENT_CONTRACT_PATH).toBe("${{ inputs.agent_contract_path }}");
      expect(step.env?.INPUT_GITHUB_TOKEN).toBe("${{ inputs.dependency_issue_token || inputs.github_token }}");
      expect(step.env?.INPUT_ISSUE_NUMBER).toBe("${{ inputs.issue_number }}");
      expect(step.env?.ISSUE_AUTOMATION_RUNTIME_DIR).toBe("${{ runner.temp }}/issue-automation");
    }
  });

  it("does not pass runtime files as git pathspecs during change detection or add", () => {
    const action = YAML.parse(fs.readFileSync("action.yml", "utf8")) as {
      runs: {
        steps: Array<{
          name?: string;
          run?: string;
        }>;
      };
    };
    const detectStep = action.runs.steps.find((step) => step.name === "Detect repository changes");
    const commitStep = action.runs.steps.find((step) => step.name === "Commit changes");

    expect(detectStep?.run).toContain("git status --porcelain -- .");
    expect(detectStep?.run).not.toContain(":(exclude)");
    expect(commitStep?.run).toContain("git add --all -- .");
    expect(commitStep?.run).toContain("git reset -q -- \"$ISSUE_CONTEXT_PATH\" 2>/dev/null || true");
    expect(commitStep?.run).toContain("git reset -q -- \"$RUNNER_RESULT_PATH\" 2>/dev/null || true");
    expect(commitStep?.run).not.toContain(":(exclude)");
  });
});
