import type { Issue, RenderContext, RuleConfig } from "./types";

/**
 * Builds the searchable text used by routing rules from an issue title and body.
 */
export function issueText(issue: Issue): string {
  return `${issue.title || ""}\n${issue.body || ""}`.toLowerCase();
}

/**
 * Checks whether any configured regular expression matches the issue text.
 */
export function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

/**
 * Returns the first matching rule value or the configured fallback value.
 */
export function classifyByRules(text: string, rules: RuleConfig[], fallback: string | null): string | null {
  const matched = rules.find((rule) => matchesAny(text, rule.patterns));
  return matched?.value ?? fallback;
}

/**
 * Converts an issue title into a stable branch-safe suffix.
 */
export function slugify(value: string): string {
  return String(value || "issue")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "issue";
}

/**
 * Normalizes runner-provided titles for commit messages and pull request titles.
 */
export function normalizeTitle(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Normalizes runner-provided multiline text and falls back when the value is blank.
 */
export function normalizeBodyText(value: unknown, fallback: string): string {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();

  return text || fallback;
}

/**
 * Renders dependency issue templates with parent issue and repository values.
 */
export function renderTemplate(template: string, context: RenderContext): string {
  return template
    .replaceAll("{owner}", context.owner)
    .replaceAll("{repo}", context.repo)
    .replaceAll("{issue_number}", String(context.issueNumber))
    .replaceAll("{issue_title}", context.issueTitle)
    .replaceAll("{parent_url}", context.parentUrl);
}
