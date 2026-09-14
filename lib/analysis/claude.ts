import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";
import { AnalysisError } from "./schema.ts";

export type Effort = "low" | "medium" | "high";

// Responses are compact JSON (cue indices and short paraphrases), so this leaves room for adaptive
// thinking while keeping requests non-streaming.
const MAX_TOKENS = 16000;
const REQUEST_TIMEOUT_MS = 4 * 60_000;

export interface ClaudeRequest {
  model: string;
  system: string;
  prompt: string;
  schema: ZodType;
  effort: Effort;
  signal?: AbortSignal;
}

function retryAfterMs(headers: Headers | undefined): number | null {
  const seconds = Number(headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
}

function claudeError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AnalysisError("Claude did not respond in time for this section.", { retryable: true });
  if (error instanceof Anthropic.APIConnectionError) return new AnalysisError("Could not reach Claude.", { retryable: true });
  if (error instanceof Anthropic.RateLimitError) return new AnalysisError("Claude's rate limit was reached.", { retryable: true, retryAfterMs: retryAfterMs(error.headers) });
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AnalysisError("Claude rejected the API key.", { unavailable: true });
  }
  if (error instanceof Anthropic.InternalServerError) return new AnalysisError(`Claude is temporarily unavailable (${error.status}).`, { retryable: true });
  if (error instanceof Anthropic.APIError) return new AnalysisError(`Claude rejected the analysis request (${error.status}).`);
  // What remains is a response that did not parse against the requested schema.
  return new AnalysisError("The model returned an analysis in an unexpected format.", { retryable: true });
}

export async function requestClaudeJson(options: ClaudeRequest): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnalysisError("ANTHROPIC_API_KEY is not configured for the worker.", { unavailable: true });
  // The worker owns retries and model fallback, so the SDK makes a single attempt.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
  // Server-side refusal fallbacks re-run a declined request on Anthropic's recommended model.
  const serverFallbacks = /^claude-(opus-5|fable-5)/.test(options.model);
  const message = await client.beta.messages.parse({
    model: options.model,
    max_tokens: MAX_TOKENS,
    system: options.system,
    messages: [{ role: "user", content: options.prompt }],
    output_config: {
      format: betaZodOutputFormat(options.schema),
      // Haiku 4.5 rejects the effort parameter.
      ...(options.model.includes("haiku") ? {} : { effort: options.effort }),
    },
    ...(serverFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  }, { signal: options.signal }).catch((error: unknown) => {
    throw claudeError(error, options.signal);
  });
  if (message.stop_reason === "refusal") throw new AnalysisError("Claude declined to analyze this section.");
  if (message.stop_reason === "max_tokens") {
    throw new AnalysisError("The analysis for this section was too long to finish. Try a smaller ANALYSIS_WINDOW_SECONDS.");
  }
  if (message.parsed_output == null) throw new AnalysisError("The model returned an analysis in an unexpected format.", { retryable: true });
  return message.parsed_output;
}
