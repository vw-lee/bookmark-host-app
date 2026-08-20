## 1. System Architecture Overview

The application is a client-side Single Page Application (SPA) hosted on a static web provider (e.g., GitHub Pages). It operates entirely without a traditional server or database, utilizing the **GitHub REST API** to achieve persistent storage by reading and committing directly to a structured file (`bookmarks.json`) housed in a private GitHub repository or Gist.

```
+-------------------------------------------------------------+
|                     Client Browser (SPA)                    |
|  [ UI Component ] <---> [ State ] <---> [ API Client ]      |
+-------------------------------------------------------------+
                                |
                   HTTPS (GitHub REST API v3)
                   Auth: Personal Access Token (PAT)
                                v
+-------------------------------------------------------------+
|                     GitHub Cloud Infrastructure             |
|  [ Private Repository / Gist ] ---> [ bookmarks.json ]       |
+-------------------------------------------------------------+

```

---

## 2. Recommended Tech Stack

* **Frontend Framework:** React, Svelte, Vue, or Vanilla JS/TypeScript.
* **Styling:** Tailwind CSS (lightweight, easily customizable for dark/e-ink high-contrast modes).
* **API Interface:** `@octokit/rest` (official GitHub API SDK) or native `fetch` wrappers.
* **Hosting:** GitHub Pages (served directly from the repo via GitHub Actions), Vercel, or Cloudflare Pages.

---

## 3. Data Schema (`bookmarks.json`)

To minimize payload overhead and API merge conflicts, structure the storage file cleanly:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-08-20T08:00:00Z",
  "tags": ["developer", "docs", "tools"],
  "bookmarks": [
    {
      "id": "b3a1c2d0-9f8e-4a1b-8c2d-3e4f5a6b7c8d",
      "url": "https://example.com",
      "title": "Example Resource",
      "description": "Short summary or context",
      "tags": ["tools"],
      "folder": "Development",
      "createdAt": "2026-08-20T08:00:00Z"
    }
  ]
}

```

---

## 4. Key Functional Requirements & Workflow

### Authentication & Security

* **Token Storage:** Store user's GitHub Personal Access Token (PAT) securely in `localStorage` or `sessionStorage` on the client side.
* **Permissions:** Require a Fine-Grained PAT restricted to `Contents: Read & Write` on the target repository only.
* **First-Run Modal:** Prompt for the PAT and target repository name (`owner/repo`) on first launch, testing connectivity via a `GET` request.

### Data Synchronization (CRUD Flow)

1. **Read (Fetch):**
* Endpoint: `GET /repos/{owner}/{repo}/contents/{path}`
* Decode response: The API returns the file content in Base64 encoding. Decode to JSON and store in application state.
* Track `sha`: Store the returned blob `sha` string in memory—this is required for atomic updates to prevent overwrite conflicts.


2. **Write (Create / Update / Delete):**
* Endpoint: `PUT /repos/{owner}/{repo}/contents/{path}`
* Payload Requirements:
* `message`: Commit message (e.g., `"feat: add bookmark [Title]"`).
* `content`: Base64-encoded string of the updated JSON array.
* `sha`: The current blob `sha` fetched during the last read.


* On success, update local state with the newly returned `sha`.



### Essential UI Features

* **Search & Filter:** Instant local filtering by title, URL, folder, or tag.
* **Quick-Add Interface:** Keyboard-driven modal for rapid link insertion.
* **Optimistic UI / Loading States:** Provide feedback during GitHub API latency (network requests to commit files typically take 300–800ms).

---

## 5. Deployment & CI/CD Pipeline

1. **GitHub Actions:** Include a `.github/workflows/deploy.yml` pipeline that triggers on `push` to the `main` branch.
2. **Build & Publish:** Automatically run the framework build step and push static assets to the `gh-pages` branch.
3. **Custom Domain Setup (Optional):** Include a `CNAME` file in the build output to route to a custom domain/subdomain with automated SSL via GitHub.
