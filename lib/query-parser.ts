import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ParsedQuery } from "./types";

const ParsedQuerySchema = z.object({
  subject: z.string().nullable(),
  topic: z.string().nullable(),
  visualRequirements: z.array(z.string()),
  targetSegmentSeconds: z
    .object({ min: z.number(), max: z.number() })
    .nullable(),
  searchTerms: z
    .string()
    .describe("A cleaned-up search query suitable for the YouTube search API"),
});

const DURATION_RANGE = /(\d+)\s*(?:-|to)\s*(\d+)\s*(?:sec(?:ond)?s?)/i;
const DURATION_SINGLE = /(?:under|less than|max(?:imum)?)\s*(\d+)\s*(?:sec(?:ond)?s?)/i;

function heuristicParse(query: string): ParsedQuery {
  let targetSegmentSeconds: { min: number; max: number } | null = null;
  const range = DURATION_RANGE.exec(query);
  const single = DURATION_SINGLE.exec(query);
  if (range) {
    targetSegmentSeconds = { min: Number(range[1]), max: Number(range[2]) };
  } else if (single) {
    targetSegmentSeconds = { min: 0, max: Number(single[1]) };
  } else if (/long[\s-]?form/i.test(query)) {
    targetSegmentSeconds = { min: 300, max: 3600 };
  }

  const searchTerms = query
    .replace(DURATION_RANGE, "")
    .replace(DURATION_SINGLE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    subject: null,
    topic: null,
    visualRequirements: [],
    targetSegmentSeconds,
    searchTerms: searchTerms || query,
    source: "heuristic",
  };
}

export async function parseSearchQuery(query: string): Promise<ParsedQuery> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return heuristicParse(query);
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system:
        "Extract structured search intent from a short-form video creator's footage search query. " +
        "Never invent facts not implied by the query. If a field is not present in the query, use null " +
        "or an empty array. searchTerms should be a concise keyword query suitable for the YouTube " +
        "search API (drop meta-instructions like target duration, keep the subject/topic/visual details).",
      messages: [{ role: "user", content: query }],
      output_config: { format: zodOutputFormat(ParsedQuerySchema) },
    });

    if (!response.parsed_output) {
      return heuristicParse(query);
    }

    return { ...response.parsed_output, source: "llm" };
  } catch {
    return heuristicParse(query);
  }
}
