import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { MemoryWikiService } from "./memoryWikiService";

export const WIKI_SEARCH_TOOL_NAME = "wiki_search";
export const WIKI_GET_TOOL_NAME = "wiki_get";
export const WIKI_APPLY_PATCH_TOOL_NAME = "wiki_apply_patch";

const searchInputSchema = z
  .object({
    query: z.string().min(1).max(200),
    scope: z
      .enum(["all", "core", "topics", "relationships", "timeline"])
      .optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const getInputSchema = z
  .object({
    page: z.string().min(1).max(255),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    ({ startLine, endLine }) =>
      startLine === undefined || endLine === undefined || endLine >= startLine,
    { message: "endLine must not be less than startLine." },
  )
  .refine(
    ({ startLine, endLine }) =>
      startLine === undefined ||
      endLine === undefined ||
      endLine - startLine + 1 <= 200,
    { message: "A single wiki_get call can read at most 200 lines." },
  );

const applyPatchInputSchema = z
  .object({
    baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    patch: z.string().min(1).max(64 * 1024),
  })
  .strict();

export function createMemoryWikiTools(
  service: MemoryWikiService,
  characterId: string,
): ToolSet {
  return {
    [WIKI_SEARCH_TOOL_NAME]: tool({
      description: [
        "Search this character's private long-term Memory Wiki.",
        "Search before answering whenever prior memory may matter.",
        "Relevant memory includes user facts, preferences, relationships, commitments, and corrections.",
        "Search again before writing to avoid duplicate or contradictory facts.",
        "Results include page paths, excerpts, line numbers, and revisions.",
        "The tool is already scoped to the current character; never ask for or invent a character ID.",
      ].join(" "),
      inputSchema: searchInputSchema,
      execute: (input) => service.search(characterId, input),
    }),
    [WIKI_GET_TOOL_NAME]: tool({
      description: [
        "Read one Markdown page, or a range of up to 200 lines, from this character's private Memory Wiki.",
        "Use the returned full-page revision as baseRevision for wiki_apply_patch.",
        "The tool is already scoped to the current character.",
      ].join(" "),
      inputSchema: getInputSchema,
      execute: (input) => service.get(characterId, input),
    }),
    [WIKI_APPLY_PATCH_TOOL_NAME]: tool({
      description: [
        "Add or update exactly one page in this character's private Memory Wiki without user approval.",
        "Use a restricted Codex patch enclosed by *** Begin Patch and *** End Patch.",
        "Include one *** Add File or *** Update File header.",
        "Delete File, Move, and multi-file patches are forbidden.",
        "Add File requires baseRevision null.",
        "Update File requires the current sha256 revision from core memory, wiki_search, or wiki_get.",
        "Search first and update an existing fact instead of adding contradictions.",
        "Retry a revision conflict at most once after reading the page again.",
        "Store only durable user facts, preferences, relationships, commitments, and corrections.",
        "Remove facts when the user asks to forget them.",
        "Never store temporary chat details, uncertain inferences, passwords, API keys, tokens, or credentials.",
      ].join(" "),
      inputSchema: applyPatchInputSchema,
      execute: (input) => service.applyPatch(characterId, input),
    }),
  };
}
