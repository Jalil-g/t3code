import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rectCenter, rectContainsPoint } from "./geometry";
import {
  findFrameByItemKey,
  reconcileLayout,
  selectLiveFrameIds,
  terminalItemKey,
  threadItemKey,
  tidyLayout,
  type CanvasFrame,
  type CanvasRegion,
  type CanvasThreadEntry,
} from "./workspaceCanvasStore";

const environmentId = EnvironmentId.make("env-1");

function entry(threadId: string, projectKey = "env-1:project-a"): CanvasThreadEntry {
  return {
    key: threadItemKey(environmentId, threadId),
    environmentId,
    threadId: ThreadId.make(threadId),
    projectKey,
  };
}

const empty: {
  frames: Record<string, CanvasFrame>;
  regions: Record<string, CanvasRegion>;
  dismissed: Record<string, true>;
} = { frames: {}, regions: {}, dismissed: {} };

describe("reconcileLayout", () => {
  it("places new threads inside their project's region without overlap", () => {
    const threads = [entry("a"), entry("b"), entry("c", "env-1:project-b")];
    const state = reconcileLayout(empty, {
      threads,
      projectKeys: new Set(["env-1:project-a", "env-1:project-b"]),
    });
    expect(Object.keys(state.regions).toSorted()).toEqual(["env-1:project-a", "env-1:project-b"]);
    for (const thread of threads) {
      const frame = findFrameByItemKey(state.frames, thread.key)!;
      expect(rectContainsPoint(state.regions[thread.projectKey]!, rectCenter(frame))).toBe(true);
    }
    const [first, second] = [threads[0]!, threads[1]!].map((thread) =>
      findFrameByItemKey(state.frames, thread.key)!,
    );
    expect(first!.x + first!.width <= second!.x || second!.x + second!.width <= first!.x).toBe(
      true,
    );
  });

  it("returns the same state when nothing changed", () => {
    const input = { threads: [entry("a")], projectKeys: new Set(["env-1:project-a"]) };
    const state = reconcileLayout(empty, input);
    expect(reconcileLayout(state, input)).toBe(state);
  });

  it("drops panes and terminals of threads that went away, but keeps kept threads", () => {
    const placed = reconcileLayout(empty, {
      threads: [entry("a"), entry("b")],
      projectKeys: new Set(["env-1:project-a"]),
    });
    const terminalKey = terminalItemKey(environmentId, "a", "term-1");
    const frameA = findFrameByItemKey(placed.frames, entry("a").key)!;
    const withTerminal = {
      ...placed,
      frames: {
        ...placed.frames,
        "frame:terminal": {
          ...frameA,
          id: "frame:terminal",
          items: [
            {
              kind: "terminal" as const,
              key: terminalKey,
              environmentId,
              threadId: ThreadId.make("a"),
              terminalId: "term-1",
            },
          ],
          activeKey: terminalKey,
        } satisfies CanvasFrame,
      },
    };
    const next = reconcileLayout(withTerminal, {
      threads: [],
      projectKeys: new Set(["env-1:project-a"]),
      keepKeys: new Set([entry("b").key]),
    });
    expect(findFrameByItemKey(next.frames, entry("a").key)).toBeNull();
    expect(findFrameByItemKey(next.frames, terminalKey)).toBeNull();
    expect(findFrameByItemKey(next.frames, entry("b").key)).not.toBeNull();
  });

  it("does not re-place a thread the user closed", () => {
    const state = reconcileLayout(
      { ...empty, dismissed: { [entry("a").key]: true as const } },
      { threads: [entry("a")], projectKeys: new Set(["env-1:project-a"]) },
    );
    expect(findFrameByItemKey(state.frames, entry("a").key)).toBeNull();
  });
});

describe("tidyLayout", () => {
  it("keeps every frame inside its region", () => {
    const placed = reconcileLayout(empty, {
      threads: [entry("a"), entry("b"), entry("c"), entry("d"), entry("e", "env-1:project-b")],
      projectKeys: new Set(["env-1:project-a", "env-1:project-b"]),
    });
    const scattered = {
      ...placed,
      frames: Object.fromEntries(
        Object.entries(placed.frames).map(([id, frame]) => [id, { ...frame, x: frame.x + 7 }]),
      ),
    };
    const tidy = tidyLayout(scattered);
    expect(Object.keys(tidy.frames)).toHaveLength(5);
    for (const thread of [entry("a"), entry("e", "env-1:project-b")]) {
      const frame = findFrameByItemKey(tidy.frames, thread.key)!;
      expect(rectContainsPoint(tidy.regions[thread.projectKey]!, rectCenter(frame))).toBe(true);
    }
  });
});

describe("selectLiveFrameIds", () => {
  function frame(id: string, x: number): CanvasFrame {
    return { id, x, y: 0, width: 100, height: 100, z: 1, items: [], activeKey: "" };
  }
  const frames = Object.fromEntries(
    [0, 200, 400, 600, 800, 1000, 1200, 5000].map((x, index) => [
      `f${index}`,
      frame(`f${index}`, x),
    ]),
  );
  const viewport = { width: 1400, height: 400 };

  it("keeps only pinned frames when zoomed out past the live threshold", () => {
    expect(
      selectLiveFrameIds({
        frames,
        view: { panX: 0, panY: 0, zoom: 0.2 },
        viewport,
        pinnedFrameIds: ["f7", null, "missing"],
      }),
    ).toEqual(["f7"]);
  });

  it("caps visible live frames, nearest to the center first, plus pinned ones", () => {
    const live = selectLiveFrameIds({
      frames,
      view: { panX: 0, panY: 0, zoom: 1 },
      viewport,
      pinnedFrameIds: ["f7"],
    });
    expect(live).toHaveLength(6);
    expect(live).toContain("f7");
    expect(live).not.toContain("f0");
  });
});
