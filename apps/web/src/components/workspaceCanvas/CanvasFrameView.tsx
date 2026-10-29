import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import {
  GripVerticalIcon,
  Maximize2Icon,
  Minimize2Icon,
  SquareArrowOutUpRightIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { createContext, use } from "react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CanvasPaneContent, useTerminalItemLabel } from "./CanvasPaneContent";
import { CanvasFrameContext } from "./canvasToggle";
import { FRAME_HEADER_HEIGHT, startFrameMove, startFrameResize } from "./canvasInteractions";
import { navigateToCanvasItem, openTerminalPaneBeside } from "./canvasNavigation";
import type { ResizeEdges } from "./geometry";
import {
  FRAME_GAP,
  activeItemOf,
  terminalItemKey,
  useCanvasSessionStore,
  useWorkspaceCanvasStore,
  type CanvasItem,
} from "./workspaceCanvasStore";

/** The canvas viewport element, for converting pointer positions to world coordinates. */
export const CanvasViewportContext = createContext<HTMLElement | null>(null);

export function CanvasFrameView(props: {
  readonly frameId: string;
  readonly live: boolean;
  readonly routeItemKey: string | null;
}) {
  const { frameId, routeItemKey } = props;
  const router = useRouter();
  const viewportElement = use(CanvasViewportContext);
  const frame = useWorkspaceCanvasStore((state) => state.frames[frameId]);
  const selected = useCanvasSessionStore((state) => state.selectedFrameIds.includes(frameId));
  const cursor = useCanvasSessionStore((state) => state.focusedFrameId === frameId);
  const expanded = useCanvasSessionStore((state) => state.expandedFrameId === frameId);
  const dropTarget = useCanvasSessionStore((state) => state.dropTargetFrameId === frameId);
  const expandedView = useWorkspaceCanvasStore((state) => (expanded ? state.view : null));
  const expandedViewport = useCanvasSessionStore((state) => (expanded ? state.viewport : null));
  if (!frame) return null;
  const active = activeItemOf(frame);
  const focused = active.key === routeItemKey;
  const live = props.live || expanded;
  // Counter the world transform so the expanded frame fills the viewport without remounting.
  const style: React.CSSProperties =
    expandedView && expandedViewport
      ? {
          transform: `translate(${-expandedView.panX / expandedView.zoom}px, ${-expandedView.panY / expandedView.zoom}px) scale(${1 / expandedView.zoom})`,
          width: expandedViewport.width,
          height: expandedViewport.height,
          zIndex: 1_000_000,
        }
      : {
          transform: `translate(${frame.x}px, ${frame.y}px)`,
          width: frame.width,
          height: frame.height,
          zIndex: frame.z,
        };

  const focusActive = () => {
    if (!focused && active.kind !== "terminal") navigateToCanvasItem(router, active);
  };

  const takeFocus = (event: React.PointerEvent) => {
    const session = useCanvasSessionStore.getState();
    useWorkspaceCanvasStore.getState().bringToFront(frameId);
    session.setFocusedFrameId(frameId);
    if (event.shiftKey || event.button !== 0) return;
    // A header press may start a drag; it focuses on release instead, so the view stays put.
    if (event.target instanceof Element && event.target.closest("[data-canvas-frame-header]")) {
      return;
    }
    focusActive();
  };

  const onHeaderPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || expanded) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    if (event.shiftKey) {
      useCanvasSessionStore.getState().toggleSelected(frameId);
      return;
    }
    if (!viewportElement) return;
    event.preventDefault();
    startFrameMove(event, frameId, viewportElement, focusActive);
  };

  const toggleExpanded = () => {
    useCanvasSessionStore.getState().setExpandedFrameId(expanded ? null : frameId);
  };

  return (
    <div
      data-canvas-frame={frameId}
      data-canvas-interactive={live && (focused || active.kind === "terminal") ? "true" : "false"}
      className={cn(
        "absolute top-0 left-0 flex origin-top-left flex-col overflow-hidden border bg-background shadow-lg/5",
        expanded ? "rounded-none" : "rounded-xl",
        focused || cursor ? "border-primary/60 ring-2 ring-primary/40 ring-inset" : "border-border",
        selected && "border-info ring-4 ring-info/60 ring-inset",
        dropTarget && "ring-4 ring-primary ring-inset",
      )}
      style={style}
      onPointerDownCapture={takeFocus}
    >
      <div
        data-canvas-frame-header
        className="flex shrink-0 cursor-grab items-center gap-1 border-b bg-muted/50 pr-1 pl-1.5 select-none active:cursor-grabbing"
        style={{ height: FRAME_HEADER_HEIGHT }}
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return;
          toggleExpanded();
        }}
      >
        <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {frame.items.map((item) => (
            <FrameTab
              key={item.key}
              item={item}
              active={item.key === active.key}
              grouped={frame.items.length > 1}
              onSelect={() => {
                useWorkspaceCanvasStore.getState().setActiveItem(frameId, item.key);
                if (item.kind !== "terminal") navigateToCanvasItem(router, item);
              }}
              onClose={() => useWorkspaceCanvasStore.getState().removeItem(item.key)}
              onDetach={() =>
                useWorkspaceCanvasStore
                  .getState()
                  .detachItem(item.key, { x: frame.x + frame.width + FRAME_GAP, y: frame.y })
              }
            />
          ))}
        </div>
        {active.kind === "thread" ? <NewTerminalButton item={active} /> : null}
        <FrameButton label={expanded ? "Exit full view" : "Full view"} onClick={toggleExpanded}>
          {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
        </FrameButton>
        <FrameButton
          label={frame.items.length > 1 ? "Close tab group" : "Close pane"}
          onClick={() => {
            if (expanded) useCanvasSessionStore.getState().setExpandedFrameId(null);
            useWorkspaceCanvasStore.getState().closeFrame(frameId);
          }}
        >
          <XIcon />
        </FrameButton>
      </div>
      {/* The frame is the containing block for the thread's fixed titlebar controls. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ "--workspace-controls-top": `${FRAME_HEADER_HEIGHT}px` } as React.CSSProperties}
      >
        <CanvasFrameContext value={frameId}>
          <CanvasPaneContent item={active} live={live} focused={focused} />
        </CanvasFrameContext>
      </div>
      {expanded ? null : <ResizeHandles frameId={frameId} />}
    </div>
  );
}

function FrameButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={props.label} onClick={props.onClick} />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function FrameTab(props: {
  readonly item: CanvasItem;
  readonly active: boolean;
  readonly grouped: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
  readonly onDetach: () => void;
}) {
  return (
    <div
      className={cn(
        "group/tab flex h-6 max-w-56 min-w-0 shrink items-center gap-1 rounded-md px-1.5 text-xs",
        props.active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer truncate text-left"
        onClick={props.onSelect}
      >
        <ItemTitle item={props.item} />
      </button>
      {props.grouped ? (
        <>
          <button
            type="button"
            aria-label="Move tab to its own pane"
            className="hidden size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm group-hover/tab:flex hover:bg-muted"
            onClick={props.onDetach}
          >
            <SquareArrowOutUpRightIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Close tab"
            className="hidden size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm group-hover/tab:flex hover:bg-muted"
            onClick={props.onClose}
          >
            <XIcon className="size-3" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function ItemTitle({ item }: { readonly item: CanvasItem }) {
  if (item.kind === "terminal") return <TerminalTitle item={item} />;
  if (item.kind === "draft") return <>New thread</>;
  return <ThreadTitle item={item} />;
}

function ThreadTitle({ item }: { readonly item: Extract<CanvasItem, { kind: "thread" }> }) {
  const shell = useQuietThreadShell(scopeThreadRef(item.environmentId, item.threadId));
  return <>{shell?.title ?? "Thread"}</>;
}

function TerminalTitle({ item }: { readonly item: Extract<CanvasItem, { kind: "terminal" }> }) {
  return (
    <span className="inline-flex items-center gap-1">
      <SquareTerminalIcon className="size-3" />
      {useTerminalItemLabel(item)}
    </span>
  );
}

function NewTerminalButton({ item }: { readonly item: Extract<CanvasItem, { kind: "thread" }> }) {
  const actions = useThreadTerminalActions(scopeThreadRef(item.environmentId, item.threadId));
  return (
    <FrameButton
      label="New terminal pane"
      onClick={() =>
        actions.launchTerminal({
          place: (terminalId) =>
            openTerminalPaneBeside(
              {
                kind: "terminal",
                key: terminalItemKey(item.environmentId, item.threadId, terminalId),
                environmentId: item.environmentId,
                threadId: item.threadId,
                terminalId,
              },
              item.key,
            ),
        })
      }
    >
      <SquareTerminalIcon />
    </FrameButton>
  );
}

const RESIZE_HANDLES: ReadonlyArray<{ readonly edges: ResizeEdges; readonly className: string }> = [
  { edges: { right: true }, className: "top-8 right-0 bottom-3 w-1.5 cursor-ew-resize" },
  { edges: { left: true }, className: "top-8 left-0 bottom-3 w-1.5 cursor-ew-resize" },
  { edges: { bottom: true }, className: "right-3 bottom-0 left-3 h-1.5 cursor-ns-resize" },
  {
    edges: { right: true, bottom: true },
    className: "right-0 bottom-0 size-3 cursor-nwse-resize",
  },
  { edges: { left: true, bottom: true }, className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
];

function ResizeHandles({ frameId }: { readonly frameId: string }) {
  return (
    <>
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.className}
          aria-hidden
          className={cn("absolute z-10", handle.className)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            startFrameResize(event, frameId, handle.edges);
          }}
        />
      ))}
    </>
  );
}
