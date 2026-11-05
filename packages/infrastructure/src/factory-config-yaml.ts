import { LineCounter, isMap, isNode, isScalar, parseDocument, type Document } from "yaml";

export type PathKey = string | number;

export interface ParsedYaml {
  doc: Document.Parsed;
  lc: LineCounter;
  text: string;
  value: unknown;
}

export type YamlResult = { ok: true; parsed: ParsedYaml } | { ok: false; line: number };

export function parseYaml(text: string): YamlResult {
  const lc = new LineCounter();
  try {
    const doc = parseDocument(text, { lineCounter: lc });
    const first = doc.errors[0];
    if (first) return { ok: false, line: first.linePos?.[0].line ?? 1 };
    return { ok: true, parsed: { doc, lc, text, value: doc.toJS() } };
  } catch {
    return { ok: false, line: 1 };
  }
}

function nodeAt(p: ParsedYaml, path: PathKey[]) {
  const node = p.doc.getIn(path, true);
  return isNode(node) && node.range ? node : null;
}

/** Line of the value at `path`, or of its nearest ancestor, or 1. */
export function valueLine(p: ParsedYaml, path: PathKey[]): number {
  for (let i = path.length; i >= 0; i--) {
    const node = nodeAt(p, path.slice(0, i));
    if (node?.range) return p.lc.linePos(node.range[0]).line;
  }
  return 1;
}

/** Source text of the value at `path` (empty if it cannot be located). */
export function valueSource(p: ParsedYaml, path: PathKey[]): string {
  const node = nodeAt(p, path);
  return node?.range ? p.text.slice(node.range[0], node.range[1]) : "";
}

/** Line of the key `key` inside the mapping at `parentPath`, or null. */
export function keyLine(p: ParsedYaml, parentPath: PathKey[], key: PathKey): number | null {
  const parent = parentPath.length === 0 ? p.doc.contents : p.doc.getIn(parentPath, true);
  if (!isMap(parent)) return null;
  for (const pair of parent.items) {
    const k = pair.key;
    const name = isScalar(k) ? String(k.value) : null;
    if (name === String(key) && isNode(k) && k.range) return p.lc.linePos(k.range[0]).line;
  }
  return null;
}
