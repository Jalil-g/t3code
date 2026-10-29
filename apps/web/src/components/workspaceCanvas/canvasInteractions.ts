import {
  rectContainsPoint,
  resizeRect,
  screenToWorld,
  snapMovedRect,
  snapResizedRect,
  type Point,
  type Rect,
  type ResizeEdges,
} from "./geometry";
import {
  FRAME_GAP,
  MIN_FRAME_SIZE,
  REGION_HEADER_HEIGHT,
  useCanvasSessionStore,
  useWorkspaceCanvasStore,
  type CanvasRegion,
} from "./workspaceCanvasStore";

const DRAG_THRESHOLD_PX = 3;
const SNAP_THRESHOLD_PX = 10;
export const FRAME_HEADER_HEIGHT = 32;

interface PointerDragHandlers {
  readonly onStart?: () => void;
  /** `delta` is in screen pixels from the pointer-down position. */
  readonly onMove: (delta: Point, event: PointerEvent) => void;
  readonly onEnd?: (event: PointerEvent, moved: boolean) => void;
}

/** Track one pointer until release, starting only once it moves past a small threshold. */
export function startPointerDrag(
  event: { readonly clientX: number; readonly clientY: number; readonly pointerId: number },
  handlers: PointerDragHandlers,
): void {
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  let moved = false;
  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const delta = { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY };
    if (!moved) {
      if (Math.hypot(delta.x, delta.y) < DRAG_THRESHOLD_PX) return;
      moved = true;
      useCanvasSessionStore.getState().setInteraction({ interacting: true });
      handlers.onStart?.();
    }
    moveEvent.preventDefault();
    handlers.onMove(delta, moveEvent);
  };
  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (moved) useCanvasSessionStore.getState().setInteraction({ interacting: false });
    handlers.onEnd?.(upEvent, moved);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function otherFrameRects(excluded: ReadonlySet<string>): Rect[] {
  return Object.values(useWorkspaceCanvasStore.getState().frames).filter(
    (frame) => !excluded.has(frame.id),
  );
}

/** World point under a client position, relative to the canvas viewport element. */
export function clientToWorld(viewportElement: Element, client: Point): Point {
  const bounds = viewportElement.getBoundingClientRect();
  return screenToWorld(useWorkspaceCanvasStore.getState().view, {
    x: client.x - bounds.left,
    y: client.y - bounds.top,
  });
}

function frameHeaderUnder(
  viewportElement: Element,
  client: Point,
  excluded: ReadonlySet<string>,
): string | null {
  const world = clientToWorld(viewportElement, client);
  const candidates = Object.values(useWorkspaceCanvasStore.getState().frames)
    .filter((frame) => !excluded.has(frame.id))
    .toSorted((a, b) => b.z - a.z);
  for (const frame of candidates) {
    if (rectContainsPoint({ ...frame, height: FRAME_HEADER_HEIGHT }, world)) return frame.id;
  }
  return null;
}

/**
 * Drag a frame by its header. Selected frames move together; a lone frame snaps to its
 * neighbors (Alt skips snapping) and joins another frame as a tab when dropped on its header.
 */
export function startFrameMove(
  event: React.PointerEvent,
  frameId: string,
  viewportElement: Element,
  onClick: () => void,
): void {
  const store = useWorkspaceCanvasStore.getState();
  const session = useCanvasSessionStore.getState();
  const frame = store.frames[frameId];
  if (!frame) return;
  const group = session.selectedFrameIds.includes(frameId)
    ? session.selectedFrameIds.filter((id) => store.frames[id] !== undefined)
    : [frameId];
  const origins = new Map(
    group.map((id) => {
      const member = store.frames[id]!;
      return [id, { x: member.x, y: member.y }] as const;
    }),
  );
  const excluded = new Set(group);
  const others = otherFrameRects(excluded);
  let dropTarget: string | null = null;
  startPointerDrag(event, {
    onMove: (delta, moveEvent) => {
      const { view } = useWorkspaceCanvasStore.getState();
      const worldDx = delta.x / view.zoom;
      const worldDy = delta.y / view.zoom;
      const moved = { ...frame, x: frame.x + worldDx, y: frame.y + worldDy };
      dropTarget =
        group.length === 1
          ? frameHeaderUnder(
              viewportElement,
              { x: moveEvent.clientX, y: moveEvent.clientY },
              excluded,
            )
          : null;
      const snap =
        group.length === 1 && !moveEvent.altKey && dropTarget === null
          ? snapMovedRect(moved, others, SNAP_THRESHOLD_PX / view.zoom, FRAME_GAP)
          : { rect: moved, guides: [] };
      const offsetX = snap.rect.x - frame.x;
      const offsetY = snap.rect.y - frame.y;
      const current = useWorkspaceCanvasStore.getState().frames;
      const next = group.flatMap((id) => {
        const origin = origins.get(id);
        const member = current[id];
        if (!origin || !member) return [];
        return [{ id, dx: origin.x + offsetX - member.x, dy: origin.y + offsetY - member.y }];
      });
      for (const step of next) {
        useWorkspaceCanvasStore.getState().moveFrames([step.id], step.dx, step.dy);
      }
      useCanvasSessionStore.getState().setInteraction({
        interacting: true,
        guides: snap.guides,
        dropTargetFrameId: dropTarget,
      });
    },
    onEnd: (_event, moved) => {
      if (!moved) {
        onClick();
        return;
      }
      if (dropTarget !== null) {
        const origin = origins.get(frameId)!;
        const state = useWorkspaceCanvasStore.getState();
        const current = state.frames[frameId];
        if (current) state.moveFrames([frameId], origin.x - current.x, origin.y - current.y);
        state.mergeFrameInto(frameId, dropTarget);
      }
    },
  });
}

export function startFrameResize(event: React.PointerEvent, frameId: string, edges: ResizeEdges) {
  const frame = useWorkspaceCanvasStore.getState().frames[frameId];
  if (!frame) return;
  const others = otherFrameRects(new Set([frameId]));
  startPointerDrag(event, {
    onMove: (delta, moveEvent) => {
      const { view } = useWorkspaceCanvasStore.getState();
      const resized = resizeRect(
        frame,
        edges,
        delta.x / view.zoom,
        delta.y / view.zoom,
        MIN_FRAME_SIZE,
      );
      const snap = moveEvent.altKey
        ? { rect: resized, guides: [] }
        : snapResizedRect(
            resized,
            edges,
            others,
            SNAP_THRESHOLD_PX / view.zoom,
            FRAME_GAP,
            MIN_FRAME_SIZE,
          );
      useWorkspaceCanvasStore.getState().setFrameRect(frameId, snap.rect);
      useCanvasSessionStore.getState().setInteraction({ interacting: true, guides: snap.guides });
    },
  });
}

/** Drag a region by its header, carrying the frames whose centers are inside it. */
export function startRegionMove(
  event: React.PointerEvent,
  region: CanvasRegion,
  frameIds: ReadonlyArray<string>,
) {
  let applied = { x: 0, y: 0 };
  startPointerDrag(event, {
    onMove: (delta) => {
      const { view, moveRegion } = useWorkspaceCanvasStore.getState();
      const target = { x: delta.x / view.zoom, y: delta.y / view.zoom };
      moveRegion(region.key, frameIds, target.x - applied.x, target.y - applied.y);
      applied = target;
    },
  });
}

const MIN_REGION_SIZE = { width: 360, height: REGION_HEADER_HEIGHT + 160 };

export function startRegionResize(event: React.PointerEvent, region: CanvasRegion) {
  startPointerDrag(event, {
    onMove: (delta) => {
      const { view, setRegionRect } = useWorkspaceCanvasStore.getState();
      setRegionRect(
        region.key,
        resizeRect(
          region,
          { right: true, bottom: true },
          delta.x / view.zoom,
          delta.y / view.zoom,
          MIN_REGION_SIZE,
        ),
      );
    },
  });
}
