import type { ZodType } from "zod";
import { AnalysisError } from "./schema.ts";
import type { AnalysisRole } from "./schema.ts";
import { requestClaudeJson } from "./claude.ts";
import type { Effort } from "./claude.ts";
import { configuredModels, requestGeminiJson } from "./gemini.ts";

export type Provider = "claude" | "gemini";
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

export function providerOf(model: string): Provider {
  if (/^claude-[a-z0-9.-]+$/.test(model)) return "claude";
  if (/^gemini-[a-zA-Z0-9._-]+$/.test(model)) return "gemini";
  throw new AnalysisError("A configured analysis model name is invalid. Use a claude-… or gemini-… model ID.");
}

/**
 * Model chains per role, primary first. Text roles use Claude when ANTHROPIC_API_KEY is set and fall
 * back to the Gemini models; only Gemini accepts public YouTube videos, so it alone scans footage.
 */
export function roleModels(env: Record<string, string | undefined> = process.env): Record<AnalysisRole, string[]> {
  const gemini = env.GEMINI_API_KEY ? configuredModels(env) : [];
  const textChain = (configured: string | undefined) => {
    const primary = configured?.trim() || (env.ANTHROPIC_API_KEY ? DEFAULT_CLAUDE_MODEL : "");
    const usable = primary && (providerOf(primary) === "claude" ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY);
    return [...new Set([...(usable ? [primary] : []), ...gemini])];
  };
  return { reader: textChain(env.ANALYSIS_READER_MODEL), reviewer: textChain(env.ANALYSIS_REVIEWER_MODEL), visual: gemini };
}

export interface TextRequest {
  system: string;
  prompt: string;
  schema: ZodType;
  effort: Effort;
  signal?: AbortSignal;
}

/** Sends a text-only structured request to whichever provider serves the model. */
export function requestTextJson(model: string, request: TextRequest): Promise<unknown> {
  if (providerOf(model) === "claude") return requestClaudeJson({ model, ...request });
  return requestGeminiJson({
    model, system: request.system, prompt: request.prompt, schema: request.schema, thinkingLevel: request.effort, signal: request.signal,
  });
}
