import type { Context } from "./context.js";

export type StepResult =
  | { status: "applied"; detail: string }
  | { status: "skipped"; detail: string }
  /** The file is not in a shape the step recognizes; it was left untouched. */
  | { status: "manual"; detail: string; snippet: string };

export interface Step {
  name: string;
  run(context: Context): StepResult;
}

export const applied = (detail: string): StepResult => ({ status: "applied", detail });
export const skipped = (detail: string): StepResult => ({ status: "skipped", detail });
export const manual = (detail: string, snippet: string): StepResult => ({
  status: "manual",
  detail,
  snippet,
});
