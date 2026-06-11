import { describe, expect, it, vi } from "vitest";

import { optionalBooleanInput } from "../src/inputs";

describe("inputs", () => {
  it("defaults blank optional booleans to false without strict boolean parsing", () => {
    const actionsCore = {
      getInput: vi.fn().mockReturnValue(""),
      getBooleanInput: vi.fn(),
    };

    expect(optionalBooleanInput(actionsCore, "force_ai")).toBe(false);
    expect(actionsCore.getBooleanInput).not.toHaveBeenCalled();
  });

  it("uses strict boolean parsing when the input is present", () => {
    const actionsCore = {
      getInput: vi.fn().mockReturnValue("false"),
      getBooleanInput: vi.fn().mockReturnValue(false),
    };

    expect(optionalBooleanInput(actionsCore, "force_ai")).toBe(false);
    expect(actionsCore.getBooleanInput).toHaveBeenCalledWith("force_ai");
  });
});
