import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

/**
 * The production Content-Security-Policy (README §5.2), asserted in CI by scripts/check-csp.mjs.
 *
 * connect-src is the important line: it is the only host the app may talk to, which is real
 * defence in depth even though it cannot stop navigation-based exfiltration (§5.4).
 */
export const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.github.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  // 'self' rather than 'none': the app has real forms, and while every handler calls
  // preventDefault, a policy that would break submission if one ever did not is a trap.
  // Exfiltration to another origin is still blocked.
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Inject the CSP on build only. In dev the meta tag would block Vite's HMR client, and
 * loosening the policy to accommodate dev would mean shipping a policy nobody had tested.
 */
function cspPlugin(): Plugin {
  return {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base so one build works from a project Pages path and from a custom domain.
  base: "./",
  plugins: [svelte(), tailwindcss(), cspPlugin()],
  // Without the browser condition, Vitest resolves Svelte's server build and mount() throws.
  // Scoped to test runs so the production build resolution is untouched.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : {},
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
