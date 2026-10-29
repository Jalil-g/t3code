import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { GitBranchIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { cn, randomUUID } from "../../lib/utils";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { PersistentThreadTerminalPanel } from "../PersistentThreadTerminals";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { openTerminalPaneBeside } from "./canvasNavigation";
import {
  terminalItemKey,
  threadItemKey,
  useWorkspaceCanvasStore,
  type CanvasItem,
} from "./workspaceCanvasStore";

type ThreadItem = Extract<CanvasItem, { kind: "thread" }>;
type DraftItem = Extract<CanvasItem, { kind: "draft" }>;
type TerminalItem = Extract<CanvasItem, { kind: "terminal" }>;

interface PaneProps {
  /** Render the real content rather than a light card. */
  readonly live: boolean;
  /** The routed pane: interactive, with shortcuts and the composer. */
  readonly focused: boolean;
}

export function CanvasPaneContent(props: PaneProps & { readonly item: CanvasItem }) {
  const { item } = props;
  if (item.kind === "terminal") return <CanvasTerminalContent {...props} item={item} />;
  if (item.kind === "draft") return <CanvasDraftContent {...props} item={item} />;
  return <CanvasThreadContent {...props} item={item} />;
}

function CanvasThreadContent({ item, live, focused }: PaneProps & { readonly item: ThreadItem }) {
  if (!live) return <ThreadCard item={item} />;
  return (
    <ChatPane focused={focused}>
      <ChatView
        key={item.mountKey ?? item.key}
        environmentId={item.environmentId}
        threadId={item.threadId}
        routeKind="server"
        reserveTitleBarControlInset={false}
      />
    </ChatPane>
  );
}

function CanvasDraftContent({ item, live, focused }: PaneProps & { readonly item: DraftItem }) {
  const session = useComposerDraftStore((store) => store.getDraftSession(item.draftId));
  const redirect = useComposerDraftStore((store) =>
    session === null ? store.getPromotedDraftRedirect(item.draftId) : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the draft store promotes or discards drafts outside the canvas; the layout follows
  useEffect(() => {
    if (session !== null) return;
    const { replaceItem, removeItem } = useWorkspaceCanvasStore.getState();
    if (redirect === null) {
      removeItem(item.key);
      return;
    }
    replaceItem(item.key, {
      kind: "thread",
      key: threadItemKey(redirect.environmentId, redirect.threadId),
      environmentId: redirect.environmentId,
      threadId: redirect.threadId,
      mountKey: item.draftId,
    });
  }, [item.draftId, item.key, redirect, session]);
  if (session === null) return null;
  if (!live)
    return <DraftCard projectRef={scopeProjectRef(session.environmentId, session.projectId)} />;
  return (
    <ChatPane focused={focused}>
      <ChatView
        key={item.draftId}
        draftId={item.draftId}
        environmentId={session.environmentId}
        threadId={session.threadId}
        routeKind="draft"
        reserveTitleBarControlInset={false}
        forceExpandedMobileComposer
      />
    </ChatPane>
  );
}

/** Unfocused chat panes stay mounted but inert; their global shortcuts stand down. */
function ChatPane(props: { readonly focused: boolean; readonly children: React.ReactNode }) {
  return (
    <BackgroundThreadContext value={!props.focused}>
      <div
        className="flex h-full min-h-0 flex-col [--workspace-titlebar-content-left:--spacing(3)]"
        inert={!props.focused}
      >
        {props.children}
      </div>
    </BackgroundThreadContext>
  );
}

function CardShell(props: { readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-6 overflow-hidden bg-card p-10 text-card-foreground",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

// Cards are read zoomed out, so their type is set large.
function ThreadCard({ item }: { readonly item: ThreadItem }) {
  const shell = useQuietThreadShell(scopeThreadRef(item.environmentId, item.threadId));
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const pill = shell ? resolveThreadStatusPill({ thread: shell }) : null;
  return (
    <CardShell>
      {project ? (
        <div className="flex min-w-0 items-center gap-3 text-2xl text-muted-foreground">
          <ProjectFavicon project={project} className="size-7" />
          <span className="truncate">{project.title}</span>
        </div>
      ) : null}
      <h3 className="line-clamp-4 text-5xl/tight font-semibold break-words">
        {shell?.title ?? "Thread"}
      </h3>
      {pill ? (
        <div className={cn("flex items-center gap-3 text-3xl font-medium", pill.colorClass)}>
          <span className={cn("size-4 rounded-full", pill.dotClass)} />
          {pill.label}
        </div>
      ) : null}
      {shell?.branch ? (
        <div className="mt-auto flex min-w-0 items-center gap-3 text-2xl text-muted-foreground">
          <GitBranchIcon className="size-7 shrink-0" />
          <span className="truncate font-mono">{shell.branch}</span>
        </div>
      ) : null}
    </CardShell>
  );
}

function DraftCard({ projectRef }: { readonly projectRef: ReturnType<typeof scopeProjectRef> }) {
  const project = useProject(projectRef);
  return (
    <CardShell>
      {project ? (
        <div className="flex min-w-0 items-center gap-3 text-2xl text-muted-foreground">
          <ProjectFavicon project={project} className="size-7" />
          <span className="truncate">{project.title}</span>
        </div>
      ) : null}
      <h3 className="text-5xl/tight font-semibold text-muted-foreground">New thread</h3>
    </CardShell>
  );
}

export function useTerminalItemLabel(item: TerminalItem): string {
  const sessions = useKnownTerminalSessions({
    environmentId: item.environmentId,
    threadId: item.threadId,
  });
  const summary =
    sessions?.find((session) => session.target.terminalId === item.terminalId)?.state.summary ??
    null;
  return resolveTerminalSessionLabel(item.terminalId, summary);
}

function CanvasTerminalContent({ item, live }: PaneProps & { readonly item: TerminalItem }) {
  const label = useTerminalItemLabel(item);
  if (!live) {
    return (
      <CardShell className="items-start justify-center">
        <SquareTerminalIcon className="size-12 text-muted-foreground" />
        <h3 className="truncate text-5xl font-semibold">{label}</h3>
      </CardShell>
    );
  }
  return <LiveTerminal item={item} />;
}

function LiveTerminal({ item }: { readonly item: TerminalItem }) {
  const threadRef = scopeThreadRef(item.environmentId, item.threadId);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const actions = useThreadTerminalActions(threadRef);
  const surface = {
    id: `terminal:${item.terminalId}` as const,
    kind: "terminal" as const,
    resourceId: item.terminalId,
    terminalIds: [item.terminalId],
    activeTerminalId: item.terminalId,
  };
  const openTerminalBeside = () => {
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
    });
  };
  return (
    <PersistentThreadTerminalPanel
      visible
      threadRef={threadRef}
      surface={surface}
      launchContext={null}
      keybindings={keybindings}
      onAddTerminalContext={(selection) =>
        useComposerDraftStore.getState().addTerminalContexts(threadRef, [
          {
            id: randomUUID(),
            threadId: item.threadId,
            createdAt: new Date().toISOString(),
            ...selection,
          },
        ])
      }
      onSplitTerminal={openTerminalBeside}
      onSplitTerminalVertical={openTerminalBeside}
      onNewTerminal={openTerminalBeside}
      onActiveTerminalChange={() => undefined}
      onCloseTerminal={(terminalId) => {
        actions.closeTerminalSession(terminalId);
        useWorkspaceCanvasStore.getState().removeItem(item.key);
      }}
    />
  );
}
