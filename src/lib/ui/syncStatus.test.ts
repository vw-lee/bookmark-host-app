import { describe, it, expect } from "vitest";
import { describeSync, parkedSeconds, relativeTime, type SyncSnapshot } from "./syncStatus";

/**
 * The sync status ranking (task 7n).
 *
 * The reason this file exists is the set of states the old header chain could not name. An
 * expired token, a file past the 1 MB ceiling, and a collection that had never connected all
 * fell through every branch and rendered as blank space — which reads as "fine". Those three
 * cases are asserted first, and they are the ones that must never regress.
 */

const NOW = Date.parse("2026-09-09T12:00:00.000Z");

function snapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    connected: true,
    syncing: false,
    offline: false,
    pendingCount: 0,
    parkedUntil: null,
    lastSyncedAt: "2026-09-09T11:58:00.000Z",
    tokenExpired: false,
    hasError: false,
    size: { bytes: 1000, ratio: 0.001, level: "ok" },
    persistence: "granted",
    now: NOW,
    ...over,
  };
}

describe("states the old header could not name", () => {
  it("names an expired token rather than showing nothing", () => {
    const status = describeSync(snapshot({ tokenExpired: true }));
    expect(status.kind).toBe("expired");
    expect(status.icon).toBe("cross");
    expect(status.tone).toBe("bad");
  });

  it("names a file past the 1 MB ceiling (§4.3)", () => {
    const status = describeSync(
      snapshot({ size: { bytes: 1_100_000, ratio: 1.1, level: "critical" } }),
    );
    expect(status.kind).toBe("full");
    expect(status.icon).toBe("cross");
  });

  it("names a collection that has never connected", () => {
    // The most dangerous quiet state: every edit is local, and the old UI said nothing.
    const status = describeSync(snapshot({ connected: false, lastSyncedAt: null }));
    expect(status.kind).toBe("local");
    expect(status.icon).toBe("cross");
    expect(status.summary).toContain("nothing is backed up");
  });
});

describe("ranking", () => {
  it("puts an expired token above everything else it coincides with", () => {
    const status = describeSync(
      snapshot({
        tokenExpired: true,
        offline: true,
        syncing: true,
        pendingCount: 4,
        size: { bytes: 1_100_000, ratio: 1.1, level: "critical" },
      }),
    );
    expect(status.kind).toBe("expired");
    // The queue is still worth mentioning, just not worth leading with.
    expect(status.summary).toContain("4 changes");
  });

  it("puts a full file above offline, because reconnecting will not fix it", () => {
    const status = describeSync(
      snapshot({ offline: true, size: { bytes: 1_100_000, ratio: 1.1, level: "critical" } }),
    );
    expect(status.kind).toBe("full");
  });

  it("prefers offline over a pending count, since the count cannot move", () => {
    expect(describeSync(snapshot({ offline: true, pendingCount: 3 })).kind).toBe("offline");
  });

  it("shows a rate-limit countdown ahead of an in-flight sync", () => {
    const status = describeSync(snapshot({ parkedUntil: NOW + 42_000, syncing: true }));
    expect(status.kind).toBe("parked");
    expect(status.label).toBe("Paused 42s");
  });

  it("drops a park that has already expired", () => {
    expect(describeSync(snapshot({ parkedUntil: NOW - 1000 })).kind).toBe("synced");
  });
});

describe("tone", () => {
  it("reserves red for states only the user can clear", () => {
    for (const over of [
      { tokenExpired: true },
      { hasError: true },
      { size: { bytes: 1_100_000, ratio: 1.1, level: "critical" as const } },
    ]) {
      expect(describeSync(snapshot(over)).tone).toBe("bad");
    }
  });

  it("keeps self-resolving states amber, not red", () => {
    // A red cross every time someone goes through a tunnel trains them to ignore the
    // indicator by the time it means something.
    expect(describeSync(snapshot({ offline: true })).tone).toBe("warn");
    expect(describeSync(snapshot({ parkedUntil: NOW + 5000 })).tone).toBe("warn");
  });

  it("ticks only when there is genuinely nothing outstanding", () => {
    expect(describeSync(snapshot()).icon).toBe("tick");
    expect(describeSync(snapshot({ pendingCount: 1 })).icon).toBe("wait");
    expect(describeSync(snapshot({ syncing: true })).icon).toBe("wait");
  });

  it("uses only the three glyphs, whatever the state", () => {
    const states: Partial<SyncSnapshot>[] = [
      {},
      { syncing: true },
      { offline: true },
      { pendingCount: 2 },
      { connected: false },
      { hasError: true },
      { tokenExpired: true },
      { parkedUntil: NOW + 1000 },
      { lastSyncedAt: null },
      { size: { bytes: 1_100_000, ratio: 1.1, level: "critical" } },
    ];
    for (const over of states) {
      const status = describeSync(snapshot(over));
      expect(["tick", "wait", "cross"]).toContain(status.icon);
      // §1.2: the label has to carry the meaning on its own, because the e-ink theme
      // flattens every tone to the same black.
      expect(status.label.length).toBeGreaterThan(0);
      expect(status.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("parkedSeconds", () => {
  it("rounds up, so the last second is not skipped", () => {
    expect(parkedSeconds(NOW + 1500, NOW)).toBe(2);
  });

  it("floors at zero rather than counting backwards", () => {
    expect(parkedSeconds(NOW - 5000, NOW)).toBe(0);
    expect(parkedSeconds(null, NOW)).toBe(0);
  });
});

describe("relativeTime", () => {
  it("stays coarse", () => {
    expect(relativeTime("2026-09-09T11:59:50.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-09T11:55:00.000Z", NOW)).toBe("5 minutes ago");
    expect(relativeTime("2026-09-09T09:00:00.000Z", NOW)).toBe("3 hours ago");
    expect(relativeTime("2026-09-07T12:00:00.000Z", NOW)).toBe("2 days ago");
  });

  it("says never rather than inventing a time", () => {
    expect(relativeTime(null, NOW)).toBe("never");
    expect(relativeTime("not a date", NOW)).toBe("never");
  });

  it("singularises", () => {
    expect(relativeTime("2026-09-09T11:58:50.000Z", NOW)).toBe("1 minute ago");
  });
});
