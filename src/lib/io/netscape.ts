/**
 * Netscape bookmark HTML — import and export (tasks 4b, 4d, 4g, 4h).
 *
 * Every browser exports this format, so it is the migration path in and the escape hatch out.
 * It is also arbitrary attacker-controlled input: a bookmarks file can carry `javascript:` URLs
 * and HTML payloads in folder and title text, and it may have come from anywhere.
 *
 * The parse therefore goes through DOMParser into a DETACHED document and reads textContent
 * only (§5.4). Nothing from the file is ever interpreted as markup, and folder paths become tag
 * paths through the same normaliser every other write path uses (§3.3.4).
 */
import type { Bookmark } from "../schema/types";
import { cleanText, isSafeUrl, normalizeTags, normalizeUrlKey } from "../schema/normalize";
import { ulid } from "../schema/ulid";

const MAX_TITLE = 500;
const MAX_DESCRIPTION = 2000;

export interface ParsedBookmark {
  url: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
}

export interface ImportReport {
  parsed: ParsedBookmark[];
  /** Entries rejected for an unsafe or unparseable URL, with the reason. */
  rejected: { url: string; reason: string }[];
  /** Tag spellings that collapsed into one canonical tag (§3.3.4). */
  tagCollapses: { canonical: string; sources: string[] }[];
}

function toIso(secondsAttr: string | null): string {
  const seconds = Number(secondsAttr);
  if (!secondsAttr || Number.isNaN(seconds) || seconds <= 0) return new Date().toISOString();
  const ms = seconds * 1000;
  // Reject absurd timestamps rather than producing an invalid ISO string.
  return ms > 0 && ms < 4_102_444_800_000 ? new Date(ms).toISOString() : new Date().toISOString();
}

/**
 * Parse Netscape bookmark HTML.
 *
 * The format nests <DL> inside <DT> under an <H3> folder heading, and browsers emit it
 * unclosed and malformed in ways that vary by vendor. Rather than trusting the tree shape, the
 * folder path for each link is recovered by walking up from the anchor — which is robust to the
 * mismatched tags real exports contain.
 */
export function parseNetscape(html: string): ImportReport {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parsed: ParsedBookmark[] = [];
  const rejected: { url: string; reason: string }[] = [];
  const rawTagSources = new Map<string, Set<string>>();

  for (const anchor of Array.from(doc.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    // textContent, never innerHTML: a title containing markup must stay text.
    const title = cleanText(anchor.textContent ?? "", MAX_TITLE);

    if (!href) continue;
    if (!isSafeUrl(href)) {
      rejected.push({ url: href.slice(0, 120), reason: "unsupported scheme" });
      continue;
    }
    if (!normalizeUrlKey(href)) {
      rejected.push({ url: href.slice(0, 120), reason: "could not be parsed" });
      continue;
    }

    // Recover the folder path by walking ancestors for the <H3> that precedes each <DL>.
    const rawFolders: string[] = [];
    let node: Element | null = anchor.parentElement;
    while (node) {
      if (node.tagName === "DL") {
        const heading = node.previousElementSibling;
        const h3 =
          heading?.tagName === "H3" ? heading : (heading?.querySelector?.("h3") ?? null);
        const name = cleanText(h3?.textContent ?? "", 200);
        // "Bookmarks bar" and friends are chrome, not taxonomy.
        if (name && !/^(bookmarks( bar| menu| toolbar)?|favorites|other bookmarks)$/i.test(name)) {
          rawFolders.unshift(name);
        }
      }
      node = node.parentElement;
    }

    const rawPath = rawFolders.join("/");
    const tags = normalizeTags(rawPath ? [rawPath] : []);
    for (const canonical of tags) {
      if (!rawTagSources.has(canonical)) rawTagSources.set(canonical, new Set());
      rawTagSources.get(canonical)!.add(rawPath);
    }

    parsed.push({
      url: href,
      title: title || new URL(href).hostname,
      description: cleanText(anchor.getAttribute("description") ?? "", MAX_DESCRIPTION),
      tags,
      createdAt: toIso(anchor.getAttribute("add_date")),
    });
  }

  const tagCollapses = [...rawTagSources.entries()]
    .filter(([, sources]) => sources.size > 1)
    .map(([canonical, sources]) => ({ canonical, sources: [...sources].sort() }));

  return { parsed, rejected, tagCollapses };
}

export interface MergePlan {
  /** Entries that will create a new record. */
  additions: ParsedBookmark[];
  /** Entries whose urlKey already exists — these update in place rather than duplicating. */
  updates: { incoming: ParsedBookmark; existingId: string; existingTitle: string }[];
  rejected: { url: string; reason: string }[];
  tagCollapses: { canonical: string; sources: string[] }[];
  /** Duplicate urlKeys WITHIN the imported file itself. */
  internalDuplicates: number;
}

/** Work out what an import would do, before it does it (task 4h — preview before apply). */
export function planImport(report: ImportReport, existing: Bookmark[]): MergePlan {
  const byKey = new Map(existing.filter((b) => !b.deletedAt).map((b) => [b.urlKey, b]));
  const seenInFile = new Set<string>();

  const additions: ParsedBookmark[] = [];
  const updates: MergePlan["updates"] = [];
  let internalDuplicates = 0;

  for (const entry of report.parsed) {
    const key = normalizeUrlKey(entry.url);
    if (seenInFile.has(key)) {
      internalDuplicates += 1;
      continue;
    }
    seenInFile.add(key);

    const match = byKey.get(key);
    if (match) {
      updates.push({ incoming: entry, existingId: match.id, existingTitle: match.title });
    } else {
      additions.push(entry);
    }
  }

  return {
    additions,
    updates,
    rejected: report.rejected,
    tagCollapses: report.tagCollapses,
    internalDuplicates,
  };
}

/** Build records from the additions in a plan. */
export function toBookmarks(additions: ParsedBookmark[]): Bookmark[] {
  return additions.map((entry) => {
    const now = new Date().toISOString();
    return {
      id: ulid(Date.parse(entry.createdAt) || Date.now()),
      url: entry.url,
      urlKey: normalizeUrlKey(entry.url),
      title: entry.title,
      description: entry.description,
      notes: "",
      tags: entry.tags,
      favicon: null,
      pinned: false,
      archived: false,
      createdAt: entry.createdAt,
      updatedAt: now,
      deletedAt: null,
      enrichedAt: null,
    };
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Export to Netscape HTML (task 4d).
 *
 * Flat rather than nested: tags are a many-to-many taxonomy and folders are not, so any tree we
 * invented would lose information. The tag list is written to each entry's TAGS attribute,
 * which is what other bookmark managers read.
 */
export function toNetscape(bookmarks: Bookmark[]): string {
  const rows = bookmarks
    .filter((b) => !b.deletedAt)
    .map((b) => {
      const added = Math.floor(Date.parse(b.createdAt) / 1000) || 0;
      const tags = b.tags.length > 0 ? ` TAGS="${escapeHtml(b.tags.join(","))}"` : "";
      const line = `        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${added}"${tags}>${escapeHtml(b.title)}</A>`;
      return b.description
        ? `${line}\n        <DD>${escapeHtml(b.description)}`
        : line;
    })
    .join("\n");

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Bookmarks</H3>
    <DL><p>
${rows}
    </DL><p>
</DL><p>
`;
}
