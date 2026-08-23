/**
 * Service worker registration, install prompt, and share-target handling (tasks 5a–5g).
 */

const SYNC_TAG = "bookmarks-flush";

/** Registers the worker. Failure is non-fatal — the app works fine without it. */
export async function registerServiceWorker(
  onFlushRequest: () => void,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(
      new URL("sw.js", document.baseURI).href,
      { scope: new URL("./", document.baseURI).pathname },
    );
    navigator.serviceWorker.addEventListener("message", (event) => {
      if ((event.data as { type?: string })?.type === "flush-outbox") onFlushRequest();
    });
    return registration;
  } catch {
    return null;
  }
}

/**
 * Ask the browser to flush our outbox when connectivity returns (task 3j).
 *
 * Chrome/Edge/Samsung on Android only. Everywhere else this is a no-op and the outbox flushes
 * on next open instead — later, never lossy (§6.2).
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })
      .sync;
    if (!sync) return false;
    await sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** True when running as an installed app rather than a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports as Macintosh, so touch capability is the distinguishing signal.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Capture and stash `beforeinstallprompt` (task 5g).
 *
 * The event usually fires during first-run setup, before the user has any reason to want the
 * app installed. Deferring it lets the UI make the offer after the first saved bookmark, when
 * the value is obvious. There is one shot per session: a dismissal means no refire.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function watchInstallPrompt(onAvailable: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    onAvailable();
  };
  window.addEventListener("beforeinstallprompt", handler);
  return () => window.removeEventListener("beforeinstallprompt", handler);
}

export function installAvailable(): boolean {
  return deferredPrompt !== null;
}

/** Show the native install prompt. Returns whether the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome === "accepted";
  } catch {
    deferredPrompt = null;
    return false;
  }
}

export interface SharedLink {
  url: string;
  title: string;
}

/**
 * Read a Web Share Target payload from the launch URL (task 5f).
 *
 * Android apps are wildly inconsistent about which field carries the URL: many put it in
 * `text`, some pack the title and URL together into `text`, and comparatively few use `url`.
 * A handler that reads only `params.url` silently receives empty shares from a large share of
 * apps, so all three are read and the first valid URL wins.
 */
export function readSharedLink(search: string): SharedLink | null {
  const params = new URLSearchParams(search);
  const url = params.get("url") ?? "";
  const text = params.get("text") ?? "";
  const title = params.get("title") ?? "";

  const candidate = firstUrl(url) ?? firstUrl(text) ?? firstUrl(title);
  if (!candidate) return null;

  // When the URL came out of `text`, whatever else was in there is usually the page title.
  let derivedTitle = title;
  if (!derivedTitle && text) {
    const remainder = text.replace(candidate, "").trim();
    if (remainder) derivedTitle = remainder;
  }

  return { url: candidate, title: derivedTitle.slice(0, 500) };
}

function firstUrl(value: string): string | null {
  if (!value) return null;
  const match = value.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    const parsed = new URL(match[0]);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? match[0] : null;
  } catch {
    return null;
  }
}

/** Remove share parameters from the address bar so a refresh does not re-add the bookmark. */
export function clearShareParams(): void {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const url = new URL(location.href);
  if (!url.searchParams.has("url") && !url.searchParams.has("text") && !url.searchParams.has("title"))
    return;
  url.search = "";
  history.replaceState(null, "", url.toString());
}
