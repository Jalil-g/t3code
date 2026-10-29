import type { AnyRouter } from "@tanstack/react-router";

import { centerViewOn, rectsIntersect, viewportWorldRect, type Direction } from "./geometry";
import { findRectInDirection } from "./geometry";
import {
  LIVE_MIN_ZOOM,
  activeItemOf,
  findFrameByItemKey,
  useCanvasSessionStore,
  useWorkspaceCanvasStore,
  type CanvasItem,
} from "./workspaceCanvasStore";

/** Thread and draft panes take focus through the route, so the sidebar and shortcuts follow. */
export function navigateToCanvasItem(router: AnyRouter, item: CanvasItem): void {
  if (item.kind === "thread") {
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: item.environmentId, threadId: item.threadId },
    });
  } else if (item.kind === "draft") {
    void router.navigate({ to: "/draft/$draftId", params: { draftId: item.draftId } });
  }
}

function focusCanvasFrame(router: AnyRouter, frameId: string): void {
  const frame = useWorkspaceCanvasStore.getState().frames[frameId];
  if (!frame) return;
  useWorkspaceCanvasStore.getState().bringToFront(frameId);
  useCanvasSessionStore.getState().setFocusedFrameId(frameId);
  navigateToCanvasItem(router, activeItemOf(frame));
}

/** Bring a frame into view, zooming in to a readable level if the canvas is zoomed far out. */
export function revealCanvasFrame(frameId: string, options: { readonly force?: boolean } = {}) {
  const { frames, view, setView } = useWorkspaceCanvasStore.getState();
  const { viewport } = useCanvasSessionStore.getState();
  const frame = frames[frameId];
  if (!frame || viewport.width === 0) return;
  const visible = viewportWorldRect(view, viewport);
  const readable = view.zoom >= LIVE_MIN_ZOOM;
  if (!options.force && readable && rectsIntersect(frame, visible)) {
    const inset = {
      x: visible.x + visible.width * 0.1,
      y: visible.y + visible.height * 0.1,
      width: visible.width * 0.8,
      height: visible.height * 0.8,
    };
    if (rectsIntersect(frame, inset)) return;
  }
  setView(centerViewOn(frame, viewport, readable ? view.zoom : 0.8));
}

export function moveCanvasFocus(router: AnyRouter, direction: Direction): void {
  const { frames } = useWorkspaceCanvasStore.getState();
  const { focusedFrameId } = useCanvasSessionStore.getState();
  const from = focusedFrameId === null ? undefined : frames[focusedFrameId];
  const candidates = Object.values(frames);
  const next = from ? findRectInDirection(from, candidates, direction) : candidates[0];
  if (!next) return;
  focusCanvasFrame(router, next.id);
  revealCanvasFrame(next.id);
}

/** Place a new terminal pane beside the pane holding `besideKey`, focus it and bring it into view. */
export function openTerminalPaneBeside(
  item: Extract<CanvasItem, { kind: "terminal" }>,
  besideKey: string,
): void {
  useWorkspaceCanvasStore.getState().addTerminalBeside(item, besideKey);
  const frame = findFrameByItemKey(useWorkspaceCanvasStore.getState().frames, item.key);
  if (!frame) return;
  useWorkspaceCanvasStore.getState().bringToFront(frame.id);
  useCanvasSessionStore.getState().setFocusedFrameId(frame.id);
  revealCanvasFrame(frame.id);
}
