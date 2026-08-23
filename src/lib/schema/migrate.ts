/**
 * Migration ladder (§3.1).
 *
 * Every migration is a pure function from one version to the next, applied in sequence. Adding
 * a version means adding one entry here and one test — never editing an existing migration,
 * because files written by older builds still exist in git history.
 */
import { SCHEMA_VERSION } from "./types";
import type { BookmarkFile } from "./types";
import { normalizeTags, normalizeUrlKey } from "./normalize";
import { ulid } from "./ulid";

type AnyRecord = Record<string, unknown>;

/** v1 was the original shape: a `folder` string alongside `tags`, and a top-level tag array. */
function v1ToV2(input: AnyRecord): AnyRecord {
  const bookmarks = Array.isArray(input.bookmarks) ? input.bookmarks : [];
  const now = new Date().toISOString();

  return {
    schemaVersion: 2,
    updatedAt: typeof input.lastUpdated === "string" ? input.lastUpdated : now,
    // The v1 top-level `tags` array is dropped: membership is derived (§3.1). Any presentation
    // intent it carried is not recoverable, so nothing is invented here.
    tagMeta: {},
    bookmarks: bookmarks.map((raw) => {
      const b = raw as AnyRecord;
      const url = typeof b.url === "string" ? b.url : "";
      const createdAt = typeof b.createdAt === "string" ? b.createdAt : now;

      // v1's single `folder` string becomes a tag path, merged into the tag list (§3.3).
      const folderTag = typeof b.folder === "string" && b.folder ? [b.folder] : [];
      const rawTags = Array.isArray(b.tags) ? (b.tags as string[]) : [];

      return {
        id: typeof b.id === "string" && b.id ? b.id : ulid(),
        url,
        urlKey: normalizeUrlKey(url),
        title: typeof b.title === "string" ? b.title : "",
        description: typeof b.description === "string" ? b.description : "",
        notes: "",
        tags: normalizeTags([...folderTag, ...rawTags]),
        favicon: null,
        pinned: false,
        archived: false,
        createdAt,
        // v1 had no updatedAt. Seeding it from createdAt is the only defensible choice: it
        // preserves relative ordering and never claims an edit that did not happen.
        updatedAt: createdAt,
        deletedAt: null,
        enrichedAt: null,
      };
    }),
  };
}

const LADDER: Record<number, (input: AnyRecord) => AnyRecord> = {
  1: v1ToV2,
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Bring any supported version up to SCHEMA_VERSION. Returns the raw object for the caller to
 * validate — migration and validation stay separate so a broken migration surfaces as a
 * validation error rather than silently producing a malformed file.
 */
export function migrate(input: unknown): AnyRecord {
  if (typeof input !== "object" || input === null) {
    throw new MigrationError("bookmarks.json is not an object");
  }

  let current = input as AnyRecord;
  // v1 files used `version: "1.0"`; v2 onward use an integer `schemaVersion` (§3.1).
  let version =
    typeof current.schemaVersion === "number"
      ? current.schemaVersion
      : typeof current.version === "string"
        ? Math.floor(parseFloat(current.version)) || 1
        : 1;

  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `bookmarks.json is version ${version}, but this build only understands ${SCHEMA_VERSION}. ` +
        `Update the app before writing, or the newer file will be damaged.`,
    );
  }

  while (version < SCHEMA_VERSION) {
    const step = LADDER[version];
    if (!step) throw new MigrationError(`No migration from schema version ${version}`);
    current = step(current);
    version = current.schemaVersion as number;
  }

  return current;
}

/** True if the input would be changed by migrate(). Used to decide whether to write back. */
export function needsMigration(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const v = (input as AnyRecord).schemaVersion;
  return v !== SCHEMA_VERSION;
}

export type { BookmarkFile };
