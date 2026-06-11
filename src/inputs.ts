import type * as core from "@actions/core";

type CoreInputReader = Pick<typeof core, "getInput" | "getBooleanInput">;

/**
 * Reads an optional boolean action input while treating blank values as a safe default.
 */
export function optionalBooleanInput(
  actionsCore: CoreInputReader,
  name: string,
  defaultValue = false,
): boolean {
  const rawValue = actionsCore.getInput(name);
  if (!rawValue) {
    return defaultValue;
  }

  return actionsCore.getBooleanInput(name);
}
