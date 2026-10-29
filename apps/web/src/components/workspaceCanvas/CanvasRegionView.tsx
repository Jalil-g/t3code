import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { PaletteIcon, PlusIcon } from "lucide-react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { startRegionMove, startRegionResize } from "./canvasInteractions";
import {
  REGION_COLOR_COUNT,
  REGION_HEADER_HEIGHT,
  framesInRegion,
  useWorkspaceCanvasStore,
} from "./workspaceCanvasStore";

const REGION_TINTS: ReadonlyArray<{ readonly area: string; readonly header: string }> = [
  { area: "border-sky-500/35 bg-sky-500/5", header: "text-sky-700 dark:text-sky-300" },
  { area: "border-violet-500/35 bg-violet-500/5", header: "text-violet-700 dark:text-violet-300" },
  {
    area: "border-emerald-500/35 bg-emerald-500/5",
    header: "text-emerald-700 dark:text-emerald-300",
  },
  { area: "border-amber-500/35 bg-amber-500/5", header: "text-amber-700 dark:text-amber-300" },
  { area: "border-rose-500/35 bg-rose-500/5", header: "text-rose-700 dark:text-rose-300" },
  { area: "border-cyan-500/35 bg-cyan-500/5", header: "text-cyan-700 dark:text-cyan-300" },
  { area: "border-lime-500/35 bg-lime-500/5", header: "text-lime-700 dark:text-lime-300" },
  {
    area: "border-fuchsia-500/35 bg-fuchsia-500/5",
    header: "text-fuchsia-700 dark:text-fuchsia-300",
  },
];

export const REGION_SWATCHES: ReadonlyArray<string> = [
  "#0ea5e9",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#84cc16",
  "#d946ef",
];

export function CanvasRegions() {
  const regionKeys = useWorkspaceCanvasStore((state) => Object.keys(state.regions).join("\n"));
  if (regionKeys === "") return null;
  return (
    <>
      {regionKeys.split("\n").map((key) => (
        <CanvasRegionView key={key} regionKey={key} />
      ))}
    </>
  );
}

function CanvasRegionView({ regionKey }: { readonly regionKey: string }) {
  const region = useWorkspaceCanvasStore((state) => state.regions[regionKey]);
  // Header type counter-scales so the project name stays legible when zoomed out.
  const zoom = useWorkspaceCanvasStore((state) => state.view.zoom);
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  if (!region) return null;
  const project =
    projects.find(
      (candidate) =>
        scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)) === regionKey,
    ) ?? null;
  const tint = REGION_TINTS[region.colorIndex % REGION_TINTS.length]!;
  const labelScale = Math.min(4, Math.max(1, 0.6 / zoom));
  return (
    <div
      data-canvas-region={regionKey}
      className={cn("absolute top-0 left-0 rounded-3xl border-2", tint.area)}
      style={{
        transform: `translate(${region.x}px, ${region.y}px)`,
        width: region.width,
        height: region.height,
      }}
    >
      <div
        data-canvas-control
        className="flex cursor-grab items-center gap-2 px-5 select-none active:cursor-grabbing"
        style={{ height: REGION_HEADER_HEIGHT }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (event.target instanceof Element && event.target.closest("button")) return;
          event.preventDefault();
          const frameIds = framesInRegion(useWorkspaceCanvasStore.getState().frames, region).map(
            (frame) => frame.id,
          );
          startRegionMove(event, region, frameIds);
        }}
      >
        <div
          className={cn("flex min-w-0 origin-left items-center gap-2 font-semibold", tint.header)}
          style={{ transform: `scale(${labelScale})` }}
        >
          {project ? <ProjectFavicon project={project} className="size-4" /> : null}
          <span className="truncate text-sm">{project?.title ?? "Project"}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Change region color"
                  onClick={() =>
                    useWorkspaceCanvasStore
                      .getState()
                      .setRegionColor(regionKey, (region.colorIndex + 1) % REGION_COLOR_COUNT)
                  }
                />
              }
            >
              <PaletteIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Change color</TooltipPopup>
          </Tooltip>
          {project ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`New thread in ${project.title}`}
                    onClick={() =>
                      void handleNewThread(scopeProjectRef(project.environmentId, project.id))
                    }
                  />
                }
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">New thread in {project.title}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div
        aria-hidden
        data-canvas-control
        className="absolute right-0 bottom-0 size-6 cursor-nwse-resize"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          startRegionResize(event, region);
        }}
      />
    </div>
  );
}
