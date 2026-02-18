/**
 * Markdown Parser with Hierarchical Section Extraction and Hybrid Chunking
 *
 * Ported from claude-knowledge/src/docs/parser.ts.
 *
 * Strategy:
 * - Hierarchical: preserves heading parent/child relationships
 * - Hybrid chunking: respects section boundaries but splits oversized sections
 * - Token-aware: splits at ~512 token limit with 50 token overlap
 */

import { marked } from "marked";

/** Maximum tokens per section before chunking (~2048 chars) */
export const MAX_SECTION_TOKENS = 512;
/** Overlap between chunks to preserve context (~200 chars) */
export const OVERLAP_TOKENS = 50;

/**
 * A parsed section from a markdown document.
 */
export interface ParsedSection {
  heading: string;
  content: string;
  level: number;
  anchor: string;
  parentAnchor?: string;
  isChunk?: boolean;
  chunkIndex?: number;
}

/**
 * Generate a URL-friendly slug from heading text (GitHub anchor rules).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Estimate token count (~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split an oversized section into chunks with overlap.
 */
function chunkSection(section: ParsedSection): ParsedSection[] {
  if (estimateTokens(section.content) <= MAX_SECTION_TOKENS) {
    return [section];
  }

  const chunks: ParsedSection[] = [];
  const lines = section.content.split("\n");

  // Single very long line: split by character chunks
  if (lines.length === 1 && estimateTokens(lines[0]) > MAX_SECTION_TOKENS) {
    const chunkSize = MAX_SECTION_TOKENS * 4;
    const overlapSize = OVERLAP_TOKENS * 4;
    const text = lines[0];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push({
        ...section,
        content: text.substring(start, end),
        isChunk: true,
        chunkIndex,
        anchor: `${section.anchor}-chunk-${chunkIndex}`,
      });
      chunkIndex++;
      if (end >= text.length) break;
      start = Math.max(end - overlapSize, start + 1);
    }
    return chunks;
  }

  // Multi-line: chunk by lines with overlap
  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (
      currentTokens + lineTokens > MAX_SECTION_TOKENS &&
      currentChunk.length > 0
    ) {
      chunks.push({
        ...section,
        content: currentChunk.join("\n"),
        isChunk: true,
        chunkIndex,
        anchor: `${section.anchor}-chunk-${chunkIndex}`,
      });

      // Start new chunk with overlap from tail of previous
      const overlapChars = OVERLAP_TOKENS * 4;
      let overlapContent = "";
      let overlapSize = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        const candidate = currentChunk[i];
        if (overlapSize + candidate.length <= overlapChars) {
          overlapContent = `${candidate}\n${overlapContent}`;
          overlapSize += candidate.length;
        } else {
          break;
        }
      }

      currentChunk = overlapContent ? [overlapContent.trim()] : [];
      currentTokens = estimateTokens(overlapContent);
      chunkIndex++;
    }

    currentChunk.push(line);
    currentTokens += lineTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push({
      ...section,
      content: currentChunk.join("\n"),
      isChunk: true,
      chunkIndex,
      anchor: `${section.anchor}-chunk-${chunkIndex}`,
    });
  }

  return chunks;
}

/**
 * Parse markdown into hierarchical sections with hybrid chunking.
 *
 * Uses marked.lexer() to extract tokens, builds hierarchy with a stack,
 * then applies chunking to oversized sections.
 *
 * Note: Content appearing before the first heading is intentionally dropped.
 * Only content under a heading is captured as a section.
 */
export function parseMarkdown(markdown: string): ParsedSection[] {
  if (typeof markdown !== "string") {
    throw new TypeError(
      `parseMarkdown expects a string, got ${typeof markdown}`,
    );
  }

  let tokens: ReturnType<typeof marked.lexer>;
  try {
    tokens = marked.lexer(markdown);
  } catch (error) {
    throw new Error(
      `Markdown parsing failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rawSections: ParsedSection[] = [];
  const stack: Array<{ level: number; anchor: string }> = [];
  const usedAnchors = new Map<string, number>();

  let currentHeading = "";
  let currentLevel = 0;
  let currentAnchor = "";
  let currentParentAnchor: string | undefined;
  let currentContent: string[] = [];

  for (const token of tokens) {
    if (token.type === "heading") {
      const newLevel = token.depth;

      if (currentHeading) {
        rawSections.push({
          heading: currentHeading,
          content: currentContent.join("\n").trim(),
          level: currentLevel,
          anchor: currentAnchor,
          parentAnchor: currentParentAnchor,
        });
        stack.push({ level: currentLevel, anchor: currentAnchor });
      }

      while (stack.length > 0 && stack[stack.length - 1].level >= newLevel) {
        stack.pop();
      }

      currentHeading = token.text;
      currentLevel = newLevel;

      const baseAnchor = slugify(token.text);
      const count = usedAnchors.get(baseAnchor) || 0;
      usedAnchors.set(baseAnchor, count + 1);
      currentAnchor = count === 0 ? baseAnchor : `${baseAnchor}-${count}`;

      currentParentAnchor =
        stack.length > 0 ? stack[stack.length - 1].anchor : undefined;
      currentContent = [];
    } else {
      if (token.type === "paragraph") {
        currentContent.push(token.text);
      } else if (token.type === "list") {
        const listItems = (token.items as Array<{ text: string }>).map(
          (item, index) =>
            (token as { ordered: boolean }).ordered
              ? `${index + 1}. ${item.text}`
              : `- ${item.text}`,
        );
        currentContent.push(listItems.join("\n"));
      } else if (token.type === "code") {
        currentContent.push(
          `\`\`\`${(token as { lang?: string }).lang || ""}\n${(token as { text: string }).text}\n\`\`\``,
        );
      } else if (token.type === "blockquote") {
        currentContent.push(`> ${(token as { text: string }).text}`);
      } else if (token.type === "table") {
        const t = token as {
          header: Array<{ text: string }>;
          rows: Array<Array<{ text: string }>>;
        };
        const header = t.header.map((c) => c.text).join(" | ");
        const separator = t.header.map(() => "---").join(" | ");
        const rows = t.rows
          .map((row) => row.map((c) => c.text).join(" | "))
          .join("\n| ");
        currentContent.push(`| ${header} |\n| ${separator} |\n| ${rows} |`);
      } else if (token.type === "html" || token.type === "text") {
        currentContent.push((token as { text: string }).text);
      }
    }
  }

  if (currentHeading) {
    rawSections.push({
      heading: currentHeading,
      content: currentContent.join("\n").trim(),
      level: currentLevel,
      anchor: currentAnchor,
      parentAnchor: currentParentAnchor,
    });
  }

  const result: ParsedSection[] = [];
  for (const section of rawSections) {
    result.push(...chunkSection(section));
  }
  return result;
}
