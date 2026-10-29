import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { AuthTerminalOperateScope } from "@t3tools/contracts";
import { Navigate, useRouter } from "@tanstack/react-router";
import {
  EyeIcon,
  LayoutGridIcon,
  MapIcon,
  MinusIcon,
  PlusIcon,
  RadioTowerIcon,
  ScanIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { shortcutLabelForCommand } from "../../keybindings";
import { observeResize } from "../../lib/observeResize";
import { tapTerminalInput } from "../../lib/terminalInputTap";
import { cn } from "../../lib/utils";
import { registerCommands, type CommandHandler } from "../../shortcuts/dispatcher";
import {
  useAllEnvironmentShellsBootstrapped,
  useDelegatedUnderParent,
  useProjects,
  useQuietThreadShell,
  useQuietThreadShells,
} from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { isElectron } from "../../env";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CanvasFrameView, CanvasViewportContext } from "./CanvasFrameView";
import { CanvasMinimap } from "./CanvasMinimap";
import { CanvasRegions } from "./CanvasRegionView";
import { clientToWorld, startPointerDrag } from "./canvasInteractions";
import { moveCanvasFocus, revealCanvasFrame } from "./canvasNavigation";
import { WorkspaceCanvasToggle } from "./WorkspaceCanvasToggle";
import {
  boundsOf,
  fitViewToBounds,
  normalizeRect,
  rectsIntersect,
  wheelZoomFactor,
  zoomViewAt,
  type Point,
  type Rect,
} from "./geometry";
import {
  activeItemOf,
  draftItemKey,
  findFrameByItemKey,
  selectLiveFrameIds,
  terminalItemKey,
  threadItemKey,
  useCanvasSessionStore,
  useWorkspaceCanvasStore,
  type CanvasThreadEntry,
} from "./workspaceCanvasStore";

const ZOOM_STEP = 1.25;

function routeItemKeyOf(target: ThreadRouteTarget | null): string | null {
  if (target === null) return null;
  return target.kind === "server"
    ? threadItemKey(target.threadRef.environmentId, target.threadRef.threadId)
    : draftItemKey(target.draftId);
}

/**
 * The canvas view: every active thread as a pane on a pannable, zoomable surface,
 * grouped into project regions. The routed thread is the focused, interactive pane.
 */
export function WorkspaceCanvas(props: {
  readonly routeTarget: ThreadRouteTarget | null;
  readonly background: boolean;
}) {
  const routeItemKey = routeItemKeyOf(props.routeTarget);
  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-none md:h-dvh"
      inert={props.background}
    >
      <CanvasLayoutSync routeTarget={props.routeTarget} />
      {props.background ? null : <CanvasRouteRedirect routeTarget={props.routeTarget} />}
      <CanvasToolbar />
      <CanvasViewport routeItemKey={routeItemKey} background={props.background} />
    </SidebarInset>
  );
}

function CanvasLayoutSync({ routeTarget }: { readonly routeTarget: ThreadRouteTarget | null }) {
  const shells = useQuietThreadShells();
  const projects = useProjects();
  const delegatedUnderParent = useDelegatedUnderParent();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const routeShell = useQuietThreadShell(routeThreadRef);
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const routeDraft = useComposerDraftStore((store) =>
    routeDraftId === null ? null : store.getDraftSession(routeDraftId),
  );

  const threads: CanvasThreadEntry[] = filterSidebarV2VisibleThreads(
    shells.filter((shell) => shell.deletedAt === null),
    null,
    delegatedUnderParent,
  ).map((shell) => ({
    key: threadItemKey(shell.environmentId, shell.id),
    environmentId: shell.environmentId,
    threadId: shell.id,
    projectKey: scopedProjectKey(scopeProjectRef(shell.environmentId, shell.projectId)),
  }));
  const projectKeys = new Set(
    projects.map((project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id))),
  );
  const routeKey = routeItemKeyOf(routeTarget);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists placement for threads that appeared or went away in the shell stream
  useEffect(() => {
    if (!bootstrapped) return;
    useWorkspaceCanvasStore.getState().reconcile({
      threads,
      projectKeys,
      ...(routeKey !== null ? { keepKeys: new Set([routeKey]) } : {}),
    });
  }, [bootstrapped, projectKeys, routeKey, threads]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a thread opened from the sidebar or a link gets a pane, even if it was closed or is archived
  useEffect(() => {
    const { ensureItem } = useWorkspaceCanvasStore.getState();
    if (routeShell !== null && routeShell.deletedAt === null) {
      ensureItem(
        {
          kind: "thread",
          key: threadItemKey(routeShell.environmentId, routeShell.id),
          environmentId: routeShell.environmentId,
          threadId: routeShell.id,
        },
        scopedProjectKey(scopeProjectRef(routeShell.environmentId, routeShell.projectId)),
      );
    } else if (routeDraftId !== null && routeDraft !== null) {
      ensureItem(
        { kind: "draft", key: draftItemKey(routeDraftId), draftId: routeDraftId },
        scopedProjectKey(scopeProjectRef(routeDraft.environmentId, routeDraft.projectId)),
      );
    }
  }, [routeDraft, routeDraftId, routeShell]);

  return null;
}

/** Follows a promoted draft to its thread, as the single-thread view does. */
function CanvasRouteRedirect({ routeTarget }: { readonly routeTarget: ThreadRouteTarget | null }) {
  const draftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const session = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const redirect = useComposerDraftStore((store) =>
    draftId === null || session !== null ? null : store.getPromotedDraftRedirect(draftId),
  );
  if (draftId === null || session !== null) return null;
  if (redirect === null) return <Navigate to="/" replace />;
  return (
    <Navigate to="/$environmentId/$threadId" params={buildThreadRouteParams(redirect)} replace />
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly shortcut?: string | null;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            className="[-webkit-app-region:no-drag]"
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {props.label}
        {props.shortcut ? ` (${props.shortcut})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function zoomAroundCenter(factor: number) {
  const { view, setView } = useWorkspaceCanvasStore.getState();
  const { viewport } = useCanvasSessionStore.getState();
  setView(zoomViewAt(view, factor, { x: viewport.width / 2, y: viewport.height / 2 }));
}

function zoomToFit() {
  const { frames, regions, setView } = useWorkspaceCanvasStore.getState();
  const { viewport } = useCanvasSessionStore.getState();
  const bounds = boundsOf([...Object.values(regions), ...Object.values(frames)]);
  if (!bounds || viewport.width === 0) return;
  setView(fitViewToBounds(bounds, viewport));
}

function CanvasToolbar() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const zoom = useWorkspaceCanvasStore((state) => state.view.zoom);
  const minimapOpen = useWorkspaceCanvasStore((state) => state.minimapOpen);
  const closedCount = useWorkspaceCanvasStore((state) => Object.keys(state.dismissed).length);
  const broadcastCount = useCanvasSessionStore((state) => {
    const { frames } = useWorkspaceCanvasStore.getState();
    return state.selectedFrameIds.filter((id) => {
      const frame = frames[id];
      return frame !== undefined && activeItemOf(frame).kind === "terminal";
    }).length;
  });
  const label = (command: Parameters<typeof shortcutLabelForCommand>[1]) =>
    shortcutLabelForCommand(keybindings, command, { context: { canvasOpen: true } });
  return (
    <header
      className={cn(
        "relative z-30 flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b bg-background pr-(--workspace-gutter-end) pl-(--workspace-gutter-start)",
        isElectron && "drag-region",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      <h2 className="mr-2 text-sm font-medium">Canvas</h2>
      {broadcastCount >= 2 ? (
        <span className="flex items-center gap-1.5 rounded-md bg-info/10 px-2 py-0.5 text-xs font-medium text-info-foreground">
          <RadioTowerIcon className="size-3.5" />
          Typing goes to {broadcastCount} terminals
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-0.5">
        {closedCount > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            className="[-webkit-app-region:no-drag]"
            onClick={() => useWorkspaceCanvasStore.getState().restoreDismissed()}
          >
            <EyeIcon />
            Show {closedCount} closed
          </Button>
        ) : null}
        <ToolbarButton
          label="Tidy up panes"
          onClick={() => {
            useWorkspaceCanvasStore.getState().tidy();
            zoomToFit();
          }}
        >
          <LayoutGridIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Zoom out"
          shortcut={label("canvas.zoomOut")}
          onClick={() => zoomAroundCenter(1 / ZOOM_STEP)}
        >
          <MinusIcon />
        </ToolbarButton>
        <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton
          label="Zoom in"
          shortcut={label("canvas.zoomIn")}
          onClick={() => zoomAroundCenter(ZOOM_STEP)}
        >
          <PlusIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Fit all panes"
          shortcut={label("canvas.zoomToFit")}
          onClick={zoomToFit}
        >
          <ScanIcon />
        </ToolbarButton>
        <ToolbarButton
          label={minimapOpen ? "Hide minimap" : "Show minimap"}
          shortcut={label("canvas.toggleMinimap")}
          onClick={() => useWorkspaceCanvasStore.getState().setMinimapOpen(!minimapOpen)}
        >
          <MapIcon />
        </ToolbarButton>
        <WorkspaceCanvasToggle />
      </div>
    </header>
  );
}

function CanvasWorld(props: { readonly children: React.ReactNode }) {
  const view = useWorkspaceCanvasStore((state) => state.view);
  return (
    <div
      className="absolute top-0 left-0 origin-top-left"
      style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
    >
      {props.children}
    </div>
  );
}

function CanvasBackdrop() {
  const view = useWorkspaceCanvasStore((state) => state.view);
  const spacing = 24 * view.zoom;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)]"
      style={{
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${view.panX}px ${view.panY}px`,
      }}
    />
  );
}

function CanvasFrames({ routeItemKey }: { readonly routeItemKey: string | null }) {
  const frameIds = useWorkspaceCanvasStore((state) => Object.keys(state.frames).join("\n"));
  const routeFrameId = useWorkspaceCanvasStore((state) =>
    routeItemKey === null ? null : (findFrameByItemKey(state.frames, routeItemKey)?.id ?? null),
  );
  const expandedFrameId = useCanvasSessionStore((state) => state.expandedFrameId);
  const viewport = useCanvasSessionStore((state) => state.viewport);
  // A joined string so pans that keep the same live set skip the re-render.
  const liveIds = useWorkspaceCanvasStore((state) =>
    selectLiveFrameIds({
      frames: state.frames,
      view: state.view,
      viewport,
      pinnedFrameIds: [routeFrameId, expandedFrameId],
    }).join("\n"),
  );
  if (frameIds === "") return null;
  const live = new Set(liveIds.split("\n"));
  return (
    <>
      {frameIds.split("\n").map((id) => (
        <CanvasFrameView key={id} frameId={id} live={live.has(id)} routeItemKey={routeItemKey} />
      ))}
    </>
  );
}

function CanvasGuides() {
  const guides = useCanvasSessionStore((state) => state.guides);
  return (
    <>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}:${guide.position}`}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 bg-primary"
          style={
            guide.axis === "x"
              ? {
                  transform: `translate(${guide.position}px, ${guide.start}px)`,
                  width: 1.5,
                  height: guide.end - guide.start,
                  zIndex: 999_999,
                }
              : {
                  transform: `translate(${guide.start}px, ${guide.position}px)`,
                  width: guide.end - guide.start,
                  height: 1.5,
                  zIndex: 999_999,
                }
          }
        />
      ))}
    </>
  );
}

function CanvasEmptyState() {
  const empty = useWorkspaceCanvasStore(
    (state) => Object.keys(state.frames).length === 0 && Object.keys(state.regions).length === 0,
  );
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
      Active threads appear here as panes, grouped by project. Start a thread from the sidebar.
    </div>
  );
}

function isPanSurface(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-canvas-frame], [data-canvas-control]") === null
  );
}

function CanvasViewport(props: {
  readonly routeItemKey: string | null;
  readonly background: boolean;
}) {
  const { routeItemKey, background } = props;
  const router = useRouter();
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
  const minimapOpen = useWorkspaceCanvasStore((state) => state.minimapOpen);
  const expanded = useCanvasSessionStore((state) => state.expandedFrameId !== null);
  const interacting = useCanvasSessionStore((state) => state.interacting);
  const routeFrameId = useWorkspaceCanvasStore((state) =>
    routeItemKey === null ? null : (findFrameByItemKey(state.frames, routeItemKey)?.id ?? null),
  );
  const runTerminalWrite = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const writeTerminal = useStableCallback(runTerminalWrite);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the viewport element's size into the session store for culling and fitting
  useEffect(() => {
    if (!viewportElement) return;
    const update = () =>
      useCanvasSessionStore.getState().setViewport({
        width: viewportElement.clientWidth,
        height: viewportElement.clientHeight,
      });
    update();
    return observeResize(viewportElement, update);
  }, [viewportElement]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the routed pane becomes the focused one and scrolls into view when the route moves to it
  useEffect(() => {
    if (routeFrameId === null) return;
    useWorkspaceCanvasStore.getState().bringToFront(routeFrameId);
    useCanvasSessionStore.getState().setFocusedFrameId(routeFrameId);
    revealCanvasFrame(routeFrameId);
  }, [routeFrameId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a non-passive wheel listener; React's onWheel cannot prevent the browser's pinch zoom
  useEffect(() => {
    if (!viewportElement) return;
    const onWheel = (event: WheelEvent) => {
      const frame =
        event.target instanceof Element ? event.target.closest("[data-canvas-frame]") : null;
      const zooming = event.ctrlKey || event.metaKey;
      if (
        !zooming &&
        !event.shiftKey &&
        frame?.getAttribute("data-canvas-interactive") === "true"
      ) {
        return;
      }
      if (
        !zooming &&
        event.target instanceof Element &&
        event.target.closest("[data-canvas-control]") !== null
      ) {
        return;
      }
      event.preventDefault();
      const { view, setView } = useWorkspaceCanvasStore.getState();
      if (zooming) {
        const bounds = viewportElement.getBoundingClientRect();
        setView(
          zoomViewAt(view, wheelZoomFactor(event.deltaY, event.deltaMode), {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          }),
        );
        return;
      }
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      setView({ ...view, panX: view.panX - dx * scale, panY: view.panY - dy * scale });
    };
    viewportElement.addEventListener("wheel", onWheel, { passive: false });
    return () => viewportElement.removeEventListener("wheel", onWheel);
  }, [viewportElement]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers canvas keyboard commands with the app dispatcher while the canvas is shown
  useEffect(() => {
    if (background) return;
    const run =
      (action: () => void): CommandHandler =>
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };
    const disposeCommands = registerCommands(
      {
        "canvas.focusLeft": run(() => moveCanvasFocus(router, "left")),
        "canvas.focusRight": run(() => moveCanvasFocus(router, "right")),
        "canvas.focusUp": run(() => moveCanvasFocus(router, "up")),
        "canvas.focusDown": run(() => moveCanvasFocus(router, "down")),
        "canvas.zoomIn": run(() => zoomAroundCenter(ZOOM_STEP)),
        "canvas.zoomOut": run(() => zoomAroundCenter(1 / ZOOM_STEP)),
        "canvas.zoomToFit": run(zoomToFit),
        "canvas.toggleMinimap": run(() => {
          const { minimapOpen: open, setMinimapOpen } = useWorkspaceCanvasStore.getState();
          setMinimapOpen(!open);
        }),
        "canvas.toggleExpanded": run(() => {
          const { expandedFrameId, focusedFrameId, setExpandedFrameId } =
            useCanvasSessionStore.getState();
          setExpandedFrameId(expandedFrameId !== null ? null : focusedFrameId);
        }),
      },
      { context: () => ({ canvasOpen: true }) },
    );
    const disposeEscape = registerCommands(
      {},
      {
        observe: (event, consumed) => {
          if (consumed || event.key !== "Escape") return;
          const session = useCanvasSessionStore.getState();
          if (session.expandedFrameId !== null) session.setExpandedFrameId(null);
          else if (session.selectedFrameIds.length > 0) session.setSelection([]);
        },
      },
    );
    return () => {
      disposeCommands();
      disposeEscape();
    };
  }, [background, router]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors keystrokes typed in one selected terminal to the other selected terminals
  useEffect(
    () =>
      tapTerminalInput((input) => {
        const { selectedFrameIds } = useCanvasSessionStore.getState();
        if (selectedFrameIds.length < 2) return;
        const { frames } = useWorkspaceCanvasStore.getState();
        const terminals = selectedFrameIds.flatMap((id) => {
          const frame = frames[id];
          if (!frame) return [];
          const item = activeItemOf(frame);
          return item.kind === "terminal" ? [item] : [];
        });
        const sourceKey = terminalItemKey(input.environmentId, input.threadId, input.terminalId);
        if (!terminals.some((item) => item.key === sourceKey)) return;
        for (const item of terminals) {
          if (item.key === sourceKey) continue;
          if (!readEnvironmentScope(item.environmentId, AuthTerminalOperateScope)) continue;
          void writeTerminal({
            environmentId: item.environmentId,
            input: { threadId: item.threadId, terminalId: item.terminalId, data: input.data },
          });
        }
      }),
    [writeTerminal],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const middle = event.button === 1;
    if (!middle && (event.button !== 0 || !isPanSurface(event.target))) return;
    event.preventDefault();
    const element = event.currentTarget;
    if (event.shiftKey && !middle) {
      const bounds = element.getBoundingClientRect();
      const start: Point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      startPointerDrag(event, {
        onMove: (delta) =>
          setSelectionBox(normalizeRect(start, { x: start.x + delta.x, y: start.y + delta.y })),
        onEnd: (endEvent, moved) => {
          setSelectionBox(null);
          if (!moved) return;
          const world = normalizeRect(
            clientToWorld(element, { x: event.clientX, y: event.clientY }),
            clientToWorld(element, { x: endEvent.clientX, y: endEvent.clientY }),
          );
          const hits = Object.values(useWorkspaceCanvasStore.getState().frames)
            .filter((frame) => rectsIntersect(frame, world))
            .map((frame) => frame.id);
          const session = useCanvasSessionStore.getState();
          session.setSelection([...new Set([...session.selectedFrameIds, ...hits])]);
        },
      });
      return;
    }
    const origin = useWorkspaceCanvasStore.getState().view;
    startPointerDrag(event, {
      onMove: (delta) =>
        useWorkspaceCanvasStore
          .getState()
          .setView({ ...origin, panX: origin.panX + delta.x, panY: origin.panY + delta.y }),
      onEnd: (_endEvent, moved) => {
        if (!moved) useCanvasSessionStore.getState().setSelection([]);
      },
    });
  };

  return (
    <div
      ref={setViewportElement}
      data-workspace-canvas
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/30 select-none"
      onPointerDown={onPointerDown}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
      <CanvasBackdrop />
      <CanvasViewportContext value={viewportElement}>
        <CanvasWorld>
          <CanvasRegions />
          <CanvasFrames routeItemKey={routeItemKey} />
          <CanvasGuides />
        </CanvasWorld>
      </CanvasViewportContext>
      <CanvasEmptyState />
      {selectionBox ? (
        <div
          aria-hidden
          className="pointer-events-none absolute border border-info bg-info/10"
          style={{
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      ) : null}
      {/* Keeps iframes and webviews in panes from swallowing the pointer mid-drag. */}
      {interacting ? <div aria-hidden className="absolute inset-0 z-[2000000]" /> : null}
      {minimapOpen && !expanded ? <CanvasMinimap /> : null}
    </div>
  );
}
