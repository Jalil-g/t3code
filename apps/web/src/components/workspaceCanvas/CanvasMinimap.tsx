import { boundsOf, centerViewOn, viewportWorldRect, type Point, type Rect } from "./geometry";
import { REGION_SWATCHES } from "./CanvasRegionView";
import { startPointerDrag } from "./canvasInteractions";
import { useCanvasSessionStore, useWorkspaceCanvasStore } from "./workspaceCanvasStore";

const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 150;
const MINIMAP_PADDING = 8;

interface MinimapProjection {
  readonly scale: number;
  readonly offset: Point;
}

function project(bounds: Rect): MinimapProjection {
  const scale = Math.min(
    (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / Math.max(1, bounds.width),
    (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / Math.max(1, bounds.height),
  );
  return {
    scale,
    offset: {
      x: (MINIMAP_WIDTH - bounds.width * scale) / 2 - bounds.x * scale,
      y: (MINIMAP_HEIGHT - bounds.height * scale) / 2 - bounds.y * scale,
    },
  };
}

/** An overview of every pane and region; click or drag to move the view there. */
export function CanvasMinimap() {
  const frames = useWorkspaceCanvasStore((state) => state.frames);
  const regions = useWorkspaceCanvasStore((state) => state.regions);
  const view = useWorkspaceCanvasStore((state) => state.view);
  const viewport = useCanvasSessionStore((state) => state.viewport);
  const focusedFrameId = useCanvasSessionStore((state) => state.focusedFrameId);
  const visible = viewportWorldRect(view, viewport);
  const bounds = boundsOf([...Object.values(frames), ...Object.values(regions), visible]);
  if (!bounds || viewport.width === 0) return null;
  const projection = project(bounds);
  const toMinimap = (rect: Rect) => ({
    left: projection.offset.x + rect.x * projection.scale,
    top: projection.offset.y + rect.y * projection.scale,
    width: Math.max(2, rect.width * projection.scale),
    height: Math.max(2, rect.height * projection.scale),
  });

  const centerOn = (element: Element, client: Point) => {
    const box = element.getBoundingClientRect();
    const world = {
      x: (client.x - box.left - projection.offset.x) / projection.scale,
      y: (client.y - box.top - projection.offset.y) / projection.scale,
    };
    const { view: current, setView } = useWorkspaceCanvasStore.getState();
    setView(centerViewOn({ ...world, width: 0, height: 0 }, viewport, current.zoom));
  };

  return (
    <div
      data-canvas-control
      role="presentation"
      className="absolute right-3 bottom-3 z-20 cursor-crosshair overflow-hidden rounded-lg border bg-popover/90 shadow-md backdrop-blur-sm"
      style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const element = event.currentTarget;
        centerOn(element, { x: event.clientX, y: event.clientY });
        const start = { x: event.clientX, y: event.clientY };
        startPointerDrag(event, {
          onMove: (delta) => centerOn(element, { x: start.x + delta.x, y: start.y + delta.y }),
        });
      }}
    >
      {Object.values(regions).map((region) => (
        <div
          key={region.key}
          className="absolute rounded-sm border opacity-40"
          style={{
            ...toMinimap(region),
            borderColor: REGION_SWATCHES[region.colorIndex % REGION_SWATCHES.length],
          }}
        />
      ))}
      {Object.values(frames).map((frame) => (
        <div
          key={frame.id}
          className={
            frame.id === focusedFrameId
              ? "absolute rounded-xs bg-primary"
              : "absolute rounded-xs bg-muted-foreground/45"
          }
          style={toMinimap(frame)}
        />
      ))}
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-primary/70"
        style={toMinimap(visible)}
      />
    </div>
  );
}
