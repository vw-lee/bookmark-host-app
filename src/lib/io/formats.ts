/**
 * Additional import formats (task 4c): Raindrop, Pocket, Pinboard, and generic CSV/JSON.
 *
 * Every parser funnels into the same ParsedBookmark shape and the same normalisers as the
 * Netscape importer, so a link arriving from any source is sanitised identically (§5.4).
 * Format detection is by shape rather than by filename, because exports get renamed.
 */
import type { ParsedBookmark, ImportReport } from "./netscape";
import { cleanText, isSafeUrl, normalizeTags, normalizeUrlKey } from "../schema/normalize";

const MAX_TITLE = 500;
const MAX_DESCRIPTION = 2000;

export type SourceFormat = "netscape" | "raindrop" | "pocket" | "pinboard" | "csv" | "json";

/** Shared gate: an entry only becomes a bookmark if its URL is safe and parseable. */
function accept(
  raw: { url: string; title?: string; description?: string; tags?: string[]; createdAt?: string },
  parsed: ParsedBookmark[],
  rejected: { url: string; reason: string }[],
): void {
  const url = String(raw.url ?? "").trim();
  if (!url) return;
  if (!isSafeUrl(url)) {
    rejected.push({ url: url.slice(0, 120), reason: "unsupported scheme" });
    return;
  }
  if (!normalizeUrlKey(url)) {
    rejected.push({ url: url.slice(0, 120), reason: "could not be parsed" });
    return;
  }
  parsed.push({
    url,
    title: cleanText(raw.title ?? "", MAX_TITLE) || new URL(url).hostname,
    description: cleanText(raw.description ?? "", MAX_DESCRIPTION),
    tags: normalizeTags(raw.tags ?? []),
    createdAt: toIso(raw.createdAt),
  });
}

function toIso(value: unknown): string {
  if (typeof value === "number") {
    // Pocket and Pinboard use epoch seconds; anything above ~year 2286 is milliseconds.
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim() !== "") return toIso(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((t) => (typeof t === "string" ? t : String((t as { name?: string })?.name ?? "")));
  }
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  // Pocket nests tags as an object keyed by tag name.
  if (value && typeof value === "object") return Object.keys(value);
  return [];
}

/** Identify a format from the content itself; filenames are unreliable. */
export function detectFormat(text: string): SourceFormat | null {
  const head = text.slice(0, 4000);
  if (/<!DOCTYPE NETSCAPE-Bookmark-file-1|<DL>|<DT>/i.test(head)) return "netscape";

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      if (isPocket(data)) return "pocket";
      if (isRaindrop(data)) return "raindrop";
      if (isPinboard(data)) return "pinboard";
      return "json";
    } catch {
      return null;
    }
  }

  if (/(^|,)\s*(url|URL|href)\s*(,|$)/m.test(head.split("\n")[0] ?? "")) return "csv";
  return null;
}

function isPocket(data: unknown): boolean {
  return typeof data === "object" && data !== null && "list" in (data as object);
}

function isRaindrop(data: unknown): boolean {
  if (Array.isArray(data)) return data.some((d) => d && typeof d === "object" && "link" in d);
  return typeof data === "object" && data !== null && "items" in (data as object);
}

function isPinboard(data: unknown): boolean {
  return Array.isArray(data) && data.some((d) => d && typeof d === "object" && "href" in d);
}

function empty(): ImportReport {
  return { parsed: [], rejected: [], tagCollapses: [] };
}

/** Raindrop.io — an array of items, or `{ items: [...] }`. Uses `link`. */
export function parseRaindrop(text: string): ImportReport {
  const report = empty();
  const data = JSON.parse(text) as unknown;
  const items = Array.isArray(data)
    ? data
    : ((data as { items?: unknown[] })?.items ?? []);

  for (const raw of items as Record<string, unknown>[]) {
    accept(
      {
        url: String(raw.link ?? raw.url ?? ""),
        title: String(raw.title ?? ""),
        description: String(raw.excerpt ?? raw.note ?? ""),
        tags: [...splitTags(raw.tags), ...(raw.collection ? splitTags(raw.collection) : [])],
        createdAt: String(raw.created ?? raw.lastUpdate ?? ""),
      },
      report.parsed,
      report.rejected,
    );
  }
  return report;
}

/** Pocket — `{ list: { id: { given_url, resolved_title, time_added, tags } } }`. */
export function parsePocket(text: string): ImportReport {
  const report = empty();
  const data = JSON.parse(text) as { list?: Record<string, Record<string, unknown>> };

  for (const raw of Object.values(data.list ?? {})) {
    accept(
      {
        url: String(raw.resolved_url ?? raw.given_url ?? ""),
        title: String(raw.resolved_title ?? raw.given_title ?? ""),
        description: String(raw.excerpt ?? ""),
        tags: splitTags(raw.tags),
        createdAt: String(raw.time_added ?? ""),
      },
      report.parsed,
      report.rejected,
    );
  }
  return report;
}

/** Pinboard — an array using `href`, `description` as the title, `extended` as the note. */
export function parsePinboard(text: string): ImportReport {
  const report = empty();
  const items = JSON.parse(text) as Record<string, unknown>[];

  for (const raw of items) {
    accept(
      {
        url: String(raw.href ?? ""),
        // Pinboard names these confusingly: `description` is the title.
        title: String(raw.description ?? ""),
        description: String(raw.extended ?? ""),
        tags: splitTags(raw.tags),
        createdAt: String(raw.time ?? ""),
      },
      report.parsed,
      report.rejected,
    );
  }
  return report;
}

/** Our own export, or any JSON array of objects with a url-ish field. */
export function parseGenericJson(text: string): ImportReport {
  const report = empty();
  const data = JSON.parse(text) as unknown;
  const items: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : (((data as { bookmarks?: unknown[] })?.bookmarks ?? []) as Record<string, unknown>[]);

  for (const raw of items) {
    accept(
      {
        url: String(raw.url ?? raw.link ?? raw.href ?? ""),
        title: String(raw.title ?? raw.name ?? ""),
        description: String(raw.description ?? raw.note ?? raw.excerpt ?? ""),
        tags: splitTags(raw.tags),
        createdAt: String(raw.createdAt ?? raw.created ?? raw.time ?? ""),
      },
      report.parsed,
      report.rejected,
    );
  }
  return report;
}

/**
 * Minimal RFC 4180 CSV reader — quoted fields, embedded commas, doubled quotes, CRLF.
 * Written rather than pulled in, to keep the dependency surface minimal (§5.4).
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Generic CSV with a header row naming a url column. */
export function parseCsv(text: string): ImportReport {
  const report = empty();
  const rows = parseCsvRows(text);
  if (rows.length < 2) return report;

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));

  const urlIndex = find("url", "href", "link");
  if (urlIndex === -1) return report;
  const titleIndex = find("title", "name", "description");
  const noteIndex = find("note", "notes", "excerpt", "comment");
  const tagsIndex = find("tags", "tag", "labels", "folder");
  const dateIndex = find("created", "createdat", "date", "time", "added");

  for (const row of rows.slice(1)) {
    const at = (index: number) => (index >= 0 ? (row[index] ?? "") : "");
    accept(
      {
        url: at(urlIndex),
        title: at(titleIndex),
        description: at(noteIndex),
        tags: splitTags(at(tagsIndex)),
        createdAt: at(dateIndex),
      },
      report.parsed,
      report.rejected,
    );
  }
  return report;
}

export class UnknownFormatError extends Error {
  constructor() {
    super(
      "That file was not recognised. Supported: browser bookmarks HTML, Raindrop, Pocket, " +
        "Pinboard, or a CSV with a url column.",
    );
    this.name = "UnknownFormatError";
  }
}
