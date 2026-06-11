import fs from "fs";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

describe("action metadata", () => {
  it("passes force_ai to every bundled phase runner invocation", () => {
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
    }
  });
});
