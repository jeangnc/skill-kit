import { load, YAMLException } from "js-yaml";

export interface ParsedFrontmatter {
  readonly data: unknown;
  readonly body: string;
  readonly bodyOffset: number;
}

const BOM = "﻿";
const OPEN_FENCE = "---\n";
const CLOSE_FENCE = "\n---";

export function parseFrontmatter(raw: string, srcPath: string): ParsedFrontmatter {
  const bomOffset = raw.startsWith(BOM) ? BOM.length : 0;
  const text = bomOffset === 0 ? raw : raw.slice(bomOffset);

  if (!text.startsWith(OPEN_FENCE)) {
    throw new Error(`${srcPath}: missing opening frontmatter fence "---"`);
  }

  const yamlStart = OPEN_FENCE.length;
  const closeIdx = text.indexOf(CLOSE_FENCE, yamlStart);
  if (closeIdx === -1) {
    throw new Error(`${srcPath}: missing closing frontmatter fence "---"`);
  }

  const yamlBlock = text.slice(yamlStart, closeIdx);
  let data: unknown;
  try {
    data = load(yamlBlock) ?? {};
  } catch (err) {
    if (err instanceof YAMLException) {
      throw new Error(`${srcPath}: invalid YAML frontmatter — ${err.message}`);
    }
    throw err;
  }

  let bodyStart = closeIdx + CLOSE_FENCE.length;
  if (text[bodyStart] === "\n") bodyStart += 1; // closing-fence line terminator
  if (text[bodyStart] === "\n") bodyStart += 1; // optional blank separator line
  const body = text.slice(bodyStart);
  const bodyOffset = bomOffset + bodyStart;

  return { data, body, bodyOffset };
}
