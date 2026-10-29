import { describe, expect, it } from "vite-plus/test";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  findOpenGridSlot,
  findRectInDirection,
  fitViewToBounds,
  screenToWorld,
  snapMovedRect,
  snapResizedRect,
  zoomViewAt,
} from "./geometry";

describe("zoomViewAt", () => {
  it("keeps the world point under the anchor fixed", () => {
    const view = { panX: 120, panY: -40, zoom: 0.8 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(view, anchor);
    const after = screenToWorld(zoomViewAt(view, 1.7, anchor), anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps to the zoom range", () => {
    expect(zoomViewAt({ panX: 0, panY: 0, zoom: 1 }, 100, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomViewAt({ panX: 0, panY: 0, zoom: 1 }, 0.0001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
  });
});

describe("fitViewToBounds", () => {
  it("centers the bounds and never zooms in past the cap", () => {
    const view = fitViewToBounds(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 1000, height: 800 },
    );
    expect(view.zoom).toBe(1);
    expect(view.panX).toBe(450);
    expect(view.panY).toBe(350);
  });

  it("zooms out so wide bounds fit inside the padding", () => {
    const view = fitViewToBounds(
      { x: 0, y: 0, width: 4000, height: 500 },
      { width: 1096, height: 800 },
      { padding: 48 },
    );
    expect(view.zoom).toBeCloseTo(0.25);
  });
});

describe("snapMovedRect", () => {
  const other = { x: 0, y: 0, width: 200, height: 200 };

  it("stacks beside a neighbor with the gap and reports a guide", () => {
    const { rect, guides } = snapMovedRect(
      { x: 215, y: 6, width: 100, height: 100 },
      [other],
      12,
      10,
    );
    expect(rect.x).toBe(210);
    expect(rect.y).toBe(0);
    expect(guides.map((guide) => guide.axis).toSorted()).toEqual(["x", "y"]);
  });

  it("leaves a rect alone when nothing is within the threshold", () => {
    const moved = { x: 400, y: 400, width: 100, height: 100 };
    expect(snapMovedRect(moved, [other], 12, 10)).toEqual({ rect: moved, guides: [] });
  });
});

describe("snapResizedRect", () => {
  it("snaps only the dragged edge and respects the minimum size", () => {
    const { rect } = snapResizedRect(
      { x: 0, y: 300, width: 195, height: 100 },
      { right: true },
      [{ x: 0, y: 0, width: 200, height: 200 }],
      12,
      10,
      { width: 50, height: 50 },
    );
    expect(rect).toEqual({ x: 0, y: 300, width: 200, height: 100 });
  });
});

describe("findRectInDirection", () => {
  const origin = { x: 0, y: 0, width: 100, height: 100 };
  const right = { x: 300, y: 0, width: 100, height: 100 };
  const diagonal = { x: 250, y: 400, width: 100, height: 100 };
  const below = { x: 0, y: 300, width: 100, height: 100 };

  it("prefers the candidate in line with the origin", () => {
    expect(findRectInDirection(origin, [diagonal, right, below], "right")).toBe(right);
    expect(findRectInDirection(origin, [diagonal, right, below], "down")).toBe(below);
  });

  it("returns null when nothing lies that way", () => {
    expect(findRectInDirection(origin, [right, below], "left")).toBeNull();
  });
});

describe("findOpenGridSlot", () => {
  it("skips occupied slots and wraps to the next row", () => {
    const area = { x: 0, y: 0, width: 210, height: 100 };
    const size = { width: 100, height: 100 };
    const occupied = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 110, y: 0, width: 100, height: 100 },
    ];
    expect(findOpenGridSlot(area, size, occupied, 10)).toEqual({
      x: 0,
      y: 110,
      width: 100,
      height: 100,
    });
  });
});
