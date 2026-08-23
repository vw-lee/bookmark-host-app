/**
 * CI assertion for task 0g: the built page must carry the Content-Security-Policy.
 *
 * This exists because the CSP is injected by a build plugin rather than written into
 * index.html — which means a refactor could silently drop it and nothing else would notice.
 */
import { readFileSync } from "node:fs";

const REQUIRED = [
  "default-src 'self'",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
];

let html;
try {
  html = readFileSync("dist/index.html", "utf8");
} catch {
  console.error("check-csp: dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
if (!match) {
  console.error("check-csp: FAIL — no Content-Security-Policy meta tag in the built page.");
  process.exit(1);
}

const missing = REQUIRED.filter((directive) => !match[1].includes(directive));
if (missing.length > 0) {
  console.error(`check-csp: FAIL — missing directives:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

// A stray 'unsafe-eval' would defeat the point of the policy entirely.
if (match[1].includes("'unsafe-eval'")) {
  console.error("check-csp: FAIL — 'unsafe-eval' present in the production policy.");
  process.exit(1);
}

console.log("check-csp: OK");
