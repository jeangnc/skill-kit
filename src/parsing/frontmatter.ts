import { load, YAMLException } from "js-yaml";

import { err, ok, type Result } from "../result.js";

export interface ParsedFrontmatter {
  readonly data: unknown;
  readonly body: string;
  readonly bodyOffset: number;
}

export type FrontmatterError =
  | { readonly tag: "missing-fence"; readonly position: "open" | "close" }
  | { readonly tag: "invalid-yaml"; readonly message: string };

const BOM = "﻿";
const OPEN_FENCE = "---\n";
const CLOSE_FENCE = "\n---";

export function parseFrontmatter(raw: string): Result<ParsedFrontmatter, FrontmatterError> {
  const bomOffset = raw.startsWith(BOM) ? BOM.length : 0;
  const text = bomOffset === 0 ? raw : raw.slice(bomOffset);

  if (!text.startsWith(OPEN_FENCE)) {
    return err({ tag: "missing-fence", position: "open" });
  }

  const yamlStart = OPEN_FENCE.length;
  const closeIdx = text.indexOf(CLOSE_FENCE, yamlStart);
  if (closeIdx === -1) {
    return err({ tag: "missing-fence", position: "close" });
  }

  const yamlBlock = text.slice(yamlStart, closeIdx);
  let data: unknown;
  try {
    data = load(yamlBlock) ?? {};
  } catch (e) {
    if (e instanceof YAMLException) {
      return err({ tag: "invalid-yaml", message: e.message });
    }
    throw e;
  }

  let bodyStart = closeIdx + CLOSE_FENCE.length;
  if (text[bodyStart] === "\n") bodyStart += 1;
  if (text[bodyStart] === "\n") bodyStart += 1;
  const body = text.slice(bodyStart);
  const bodyOffset = bomOffset + bodyStart;

  return ok({ data, body, bodyOffset });
}

export function formatFrontmatterError(error: FrontmatterError): string {
  switch (error.tag) {
    case "missing-fence":
      return `missing ${error.position === "open" ? "opening" : "closing"} frontmatter fence "---"`;
    case "invalid-yaml":
      return `invalid YAML frontmatter — ${error.message}`;
  }
}
