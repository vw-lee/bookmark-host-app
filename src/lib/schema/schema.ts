/**
 * Runtime validation (§3.1).
 *
 * Every load is validated. The file is hand-editable and lives in a git repo, so it WILL at
 * some point be truncated, merge-conflicted, or edited by hand — and that must surface as a
 * repairable error, never a white screen and never a silent overwrite of good data.
 */
import { z } from "zod";
import type { BookmarkFile } from "./types";

const isoDate = z.string().datetime({ offset: true });

export const bookmarkSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  urlKey: z.string(),
  title: z.string(),
  description: z.string(),
  notes: z.string(),
  tags: z.array(z.string()),
  favicon: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
  deletedAt: isoDate.nullable(),
  enrichedAt: isoDate.nullable(),
});

export const tagMetaSchema = z.object({
  color: z.string().optional(),
  order: z.number().optional(),
  label: z.string().optional(),
});

export const bookmarkFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: isoDate,
  tagMeta: z.record(z.string(), tagMetaSchema),
  bookmarks: z.array(bookmarkSchema),
});

export class SchemaError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "SchemaError";
  }
}

/** Parse and validate. Throws SchemaError with human-readable issues on failure. */
export function parseBookmarkFile(json: unknown): BookmarkFile {
  const result = bookmarkFileSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new SchemaError(`bookmarks.json failed validation (${issues.length} issue(s))`, issues);
  }
  return result.data as BookmarkFile;
}
