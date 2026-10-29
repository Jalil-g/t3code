export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

/** Screen = pan + world * zoom. */
export interface CanvasView {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const DEFAULT_VIEW: CanvasView = { panX: 0, panY: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(view: CanvasView, point: Point): Point {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom };
}

/** Zoom by `factor`, keeping the world point under the screen `anchor` fixed. */
export function zoomViewAt(view: CanvasView, factor: number, anchor: Point): CanvasView {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const world = screenToWorld(view, anchor);
  return { zoom, panX: anchor.x - world.x * zoom, panY: anchor.y - world.y * zoom };
}

/** Wheel deltas arrive in pixels, lines, or pages; pinch gestures arrive as ctrl+wheel. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-60, Math.min(60, pixels)) * 0.01);
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function boundsOf(rects: ReadonlyArray<Rect>): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** The view that shows all of `bounds` inside `viewport`, never zooming past `maxZoom`. */
export function fitViewToBounds(
  bounds: Rect,
  viewport: Size,
  options: { readonly padding?: number; readonly maxZoom?: number } = {},
): CanvasView {
  const padding = options.padding ?? 48;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(
    Math.min(
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
      options.maxZoom ?? 1,
    ),
  );
  return {
    zoom,
    panX: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    panY: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

/** Center the view on `rect` at `zoom`. */
export function centerViewOn(rect: Rect, viewport: Size, zoom: number): CanvasView {
  const center = rectCenter(rect);
  const clamped = clampZoom(zoom);
  return {
    zoom: clamped,
    panX: viewport.width / 2 - center.x * clamped,
    panY: viewport.height / 2 - center.y * clamped,
  };
}

export function viewportWorldRect(view: CanvasView, viewport: Size): Rect {
  return {
    x: -view.panX / view.zoom,
    y: -view.panY / view.zoom,
    width: viewport.width / view.zoom,
    height: viewport.height / view.zoom,
  };
}

export interface SnapGuide {
  readonly axis: "x" | "y";
  /** World coordinate of the guide line on its axis. */
  readonly position: number;
  readonly start: number;
  readonly end: number;
}

interface AxisSnap {
  readonly delta: number;
  readonly position: number;
  readonly other: Rect;
}

// A moving edge snaps to a target's same edge (alignment) or to its far edge plus `gap` (stacking).
function bestAxisSnap(
  movingEdges: ReadonlyArray<{ readonly value: number; readonly side: "start" | "end" }>,
  others: ReadonlyArray<Rect>,
  axis: "x" | "y",
  threshold: number,
  gap: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const other of others) {
    const start = axis === "x" ? other.x : other.y;
    const end = start + (axis === "x" ? other.width : other.height);
    for (const edge of movingEdges) {
      const targets = edge.side === "start" ? [start, end + gap, end] : [end, start - gap, start];
      for (const target of targets) {
        const delta = target - edge.value;
        if (Math.abs(delta) > threshold) continue;
        if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, position: target, other };
        }
      }
    }
  }
  return best;
}

function guideFor(axis: "x" | "y", snap: AxisSnap, rect: Rect): SnapGuide {
  const crossStart = axis === "x" ? Math.min(rect.y, snap.other.y) : Math.min(rect.x, snap.other.x);
  const crossEnd =
    axis === "x"
      ? Math.max(rect.y + rect.height, snap.other.y + snap.other.height)
      : Math.max(rect.x + rect.width, snap.other.x + snap.other.width);
  return { axis, position: snap.position, start: crossStart, end: crossEnd };
}

export interface SnapResult {
  readonly rect: Rect;
  readonly guides: ReadonlyArray<SnapGuide>;
}

/** Snap a moved rect's edges to nearby rects; `threshold` and `gap` are world units. */
export function snapMovedRect(
  rect: Rect,
  others: ReadonlyArray<Rect>,
  threshold: number,
  gap: number,
): SnapResult {
  const nearby = others.filter((other) =>
    rectsIntersect(
      {
        x: rect.x - threshold - gap,
        y: rect.y - threshold - gap,
        width: rect.width + (threshold + gap) * 2,
        height: rect.height + (threshold + gap) * 2,
      },
      other,
    ),
  );
  const snapX = bestAxisSnap(
    [
      { value: rect.x, side: "start" },
      { value: rect.x + rect.width, side: "end" },
    ],
    nearby,
    "x",
    threshold,
    gap,
  );
  const snapY = bestAxisSnap(
    [
      { value: rect.y, side: "start" },
      { value: rect.y + rect.height, side: "end" },
    ],
    nearby,
    "y",
    threshold,
    gap,
  );
  const snapped = {
    ...rect,
    x: rect.x + (snapX?.delta ?? 0),
    y: rect.y + (snapY?.delta ?? 0),
  };
  const guides: SnapGuide[] = [];
  if (snapX) guides.push(guideFor("x", snapX, snapped));
  if (snapY) guides.push(guideFor("y", snapY, snapped));
  return { rect: snapped, guides };
}

export interface ResizeEdges {
  readonly left?: boolean;
  readonly right?: boolean;
  readonly bottom?: boolean;
}

export function resizeRect(start: Rect, edges: ResizeEdges, dx: number, dy: number, min: Size) {
  let { x, width } = start;
  let height = start.height;
  if (edges.right) width = Math.max(min.width, start.width + dx);
  if (edges.left) {
    width = Math.max(min.width, start.width - dx);
    x = start.x + start.width - width;
  }
  if (edges.bottom) height = Math.max(min.height, start.height + dy);
  return { x, y: start.y, width, height };
}

/** Snap only the edges being dragged, keeping the opposite edges fixed. */
export function snapResizedRect(
  rect: Rect,
  edges: ResizeEdges,
  others: ReadonlyArray<Rect>,
  threshold: number,
  gap: number,
  min: Size,
): SnapResult {
  const guides: SnapGuide[] = [];
  let { x, width, height } = rect;
  if (edges.right || edges.left) {
    const side = edges.right ? "end" : "start";
    const value = edges.right ? rect.x + rect.width : rect.x;
    const snap = bestAxisSnap([{ value, side }], others, "x", threshold, gap);
    if (snap) {
      if (edges.right) width = Math.max(min.width, rect.width + snap.delta);
      else {
        const right = rect.x + rect.width;
        width = Math.max(min.width, rect.width - snap.delta);
        x = right - width;
      }
      guides.push(guideFor("x", snap, rect));
    }
  }
  if (edges.bottom) {
    const snap = bestAxisSnap(
      [{ value: rect.y + rect.height, side: "end" }],
      others,
      "y",
      threshold,
      gap,
    );
    if (snap) {
      height = Math.max(min.height, rect.height + snap.delta);
      guides.push(guideFor("y", snap, rect));
    }
  }
  return { rect: { x, y: rect.y, width, height }, guides };
}

export type Direction = "left" | "right" | "up" | "down";

/** The nearest rect whose center lies in `direction`, favoring ones in line with `from`. */
export function findRectInDirection<T extends Rect>(
  from: Rect,
  candidates: ReadonlyArray<T>,
  direction: Direction,
): T | null {
  const origin = rectCenter(from);
  let best: T | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (candidate === from) continue;
    const center = rectCenter(candidate);
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const primary =
      direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 1) continue;
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * The first slot in a row-major grid inside `area` that overlaps none of `occupied`.
 * Rows extend below the area when it is full, so a slot always exists.
 */
export function findOpenGridSlot(
  area: Rect,
  size: Size,
  occupied: ReadonlyArray<Rect>,
  gap: number,
): Point {
  const columns = Math.max(1, Math.floor((area.width + gap) / (size.width + gap)));
  for (let row = 0; row < 500; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const slot = {
        x: area.x + column * (size.width + gap),
        y: area.y + row * (size.height + gap),
        width: size.width,
        height: size.height,
      };
      const padded = {
        x: slot.x - gap / 2,
        y: slot.y - gap / 2,
        width: slot.width + gap,
        height: slot.height + gap,
      };
      if (!occupied.some((rect) => rectsIntersect(padded, rect))) return slot;
    }
  }
  return { x: area.x, y: area.y + area.height + gap };
}
