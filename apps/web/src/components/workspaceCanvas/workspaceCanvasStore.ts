import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DraftId } from "../../composerDraftStore";
import { resolveStorage } from "../../lib/storage";
import { randomUUID } from "../../lib/utils";
import {
  DEFAULT_VIEW,
  boundsOf,
  clampZoom,
  findOpenGridSlot,
  rectCenter,
  rectContainsPoint,
  rectsIntersect,
  viewportWorldRect,
  type CanvasView,
  type SnapGuide,
  type Point,
  type Rect,
  type Size,
} from "./geometry";

export type CanvasItem =
  | {
      readonly kind: "thread";
      readonly key: string;
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      /** Kept from the draft this thread was promoted from, so its ChatView stays mounted. */
      readonly mountKey?: string;
    }
  | { readonly kind: "draft"; readonly key: string; readonly draftId: DraftId }
  | {
      readonly kind: "terminal";
      readonly key: string;
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly terminalId: string;
    };

/** A window on the canvas. Several items make it a tab group. */
export interface CanvasFrame extends Rect {
  readonly id: string;
  readonly z: number;
  readonly items: ReadonlyArray<CanvasItem>;
  readonly activeKey: string;
}

/** A colored area holding a project's panes; panes belong to the region their center is in. */
export interface CanvasRegion extends Rect {
  readonly key: string;
  readonly colorIndex: number;
}

export interface CanvasThreadEntry {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectKey: string;
}

const THREAD_FRAME_SIZE: Size = { width: 600, height: 720 };
const TERMINAL_FRAME_SIZE: Size = { width: 600, height: 380 };
export const MIN_FRAME_SIZE: Size = { width: 320, height: 220 };
export const FRAME_GAP = 32;
const REGION_PADDING = 40;
export const REGION_HEADER_HEIGHT = 48;
const REGION_GAP = 160;
const REGION_COLUMNS = 3;
export const REGION_COLOR_COUNT = 8;

export function threadItemKey(environmentId: string, threadId: string): string {
  return `thread:${environmentId}:${threadId}`;
}

export function draftItemKey(draftId: string): string {
  return `draft:${draftId}`;
}

export function terminalItemKey(environmentId: string, threadId: string, terminalId: string) {
  return `terminal:${environmentId}:${threadId}:${terminalId}`;
}

export function activeItemOf(frame: CanvasFrame): CanvasItem {
  return frame.items.find((item) => item.key === frame.activeKey) ?? frame.items[0]!;
}

export function findFrameByItemKey(
  frames: Readonly<Record<string, CanvasFrame>>,
  key: string,
): CanvasFrame | null {
  for (const frame of Object.values(frames)) {
    if (frame.items.some((item) => item.key === key)) return frame;
  }
  return null;
}

function regionContentArea(region: Rect): Rect {
  return {
    x: region.x + REGION_PADDING,
    y: region.y + REGION_HEADER_HEIGHT + REGION_PADDING / 2,
    width: region.width - REGION_PADDING * 2,
    height: region.height - REGION_HEADER_HEIGHT - REGION_PADDING * 1.5,
  };
}

export function framesInRegion(
  frames: Readonly<Record<string, CanvasFrame>>,
  region: Rect,
): CanvasFrame[] {
  return Object.values(frames).filter((frame) => rectContainsPoint(region, rectCenter(frame)));
}

function newRegionRect(regions: ReadonlyArray<CanvasRegion>, frames: ReadonlyArray<Rect>): Rect {
  const bounds = boundsOf([...regions, ...frames]);
  const width =
    REGION_COLUMNS * THREAD_FRAME_SIZE.width +
    (REGION_COLUMNS - 1) * FRAME_GAP +
    REGION_PADDING * 2;
  const height = THREAD_FRAME_SIZE.height + REGION_HEADER_HEIGHT + REGION_PADDING * 1.5;
  return {
    x: bounds === null ? 0 : bounds.x + bounds.width + REGION_GAP,
    y: bounds === null ? 0 : bounds.y,
    width,
    height,
  };
}

function growRegionToFit(region: CanvasRegion, rect: Rect): CanvasRegion {
  const right = Math.max(region.x + region.width, rect.x + rect.width + REGION_PADDING);
  const bottom = Math.max(region.y + region.height, rect.y + rect.height + REGION_PADDING);
  return { ...region, width: right - region.x, height: bottom - region.y };
}

function nextColorIndex(regions: ReadonlyArray<CanvasRegion>): number {
  const used = new Set(regions.map((region) => region.colorIndex));
  for (let index = 0; index < REGION_COLOR_COUNT; index += 1) {
    if (!used.has(index)) return index;
  }
  return regions.length % REGION_COLOR_COUNT;
}

function maxZ(frames: Readonly<Record<string, CanvasFrame>>): number {
  let z = 0;
  for (const frame of Object.values(frames)) z = Math.max(z, frame.z);
  return z;
}

interface PlacementState {
  frames: Record<string, CanvasFrame>;
  regions: Record<string, CanvasRegion>;
}

/** Place `item` in its project's region, creating or growing the region as needed. */
function placeInProject(
  state: PlacementState,
  item: CanvasItem,
  projectKey: string | null,
  size: Size,
): PlacementState {
  const frames = { ...state.frames };
  const regions = { ...state.regions };
  let region = projectKey === null ? null : (regions[projectKey] ?? null);
  if (projectKey !== null && region === null) {
    const rect = newRegionRect(Object.values(regions), Object.values(frames));
    region = { key: projectKey, ...rect, colorIndex: nextColorIndex(Object.values(regions)) };
  }
  const area =
    region === null
      ? (() => {
          const bounds = boundsOf([...Object.values(regions), ...Object.values(frames)]);
          return {
            x: 0,
            y: bounds === null ? 0 : bounds.y + bounds.height + REGION_GAP,
            width: REGION_COLUMNS * (size.width + FRAME_GAP),
            height: size.height,
          };
        })()
      : regionContentArea(region);
  const occupied = Object.values(frames);
  const slot = findOpenGridSlot(area, size, occupied, FRAME_GAP);
  const rect = { ...slot, ...size };
  const id = `frame:${randomUUID()}`;
  frames[id] = { id, ...rect, z: maxZ(frames) + 1, items: [item], activeKey: item.key };
  if (region !== null && projectKey !== null) regions[projectKey] = growRegionToFit(region, rect);
  return { frames, regions };
}

function withoutItem(
  frames: Readonly<Record<string, CanvasFrame>>,
  key: string,
): Record<string, CanvasFrame> {
  const next: Record<string, CanvasFrame> = {};
  for (const frame of Object.values(frames)) {
    if (!frame.items.some((item) => item.key === key)) {
      next[frame.id] = frame;
      continue;
    }
    const items = frame.items.filter((item) => item.key !== key);
    if (items.length === 0) continue;
    next[frame.id] = {
      ...frame,
      items,
      activeKey: frame.activeKey === key ? items[0]!.key : frame.activeKey,
    };
  }
  return next;
}

function isThreadLike(item: CanvasItem): item is Extract<CanvasItem, { kind: "thread" }> {
  return item.kind === "thread";
}

export interface ReconcileInput {
  /** Every active (unarchived, undeleted) server thread. */
  readonly threads: ReadonlyArray<CanvasThreadEntry>;
  /** Live project keys; regions for other keys are dropped. */
  readonly projectKeys: ReadonlySet<string>;
  /** Thread keys kept even when inactive, such as the routed thread. */
  readonly keepKeys?: ReadonlySet<string>;
}

/**
 * Bring the layout in line with the thread list: drop panes for threads that went away,
 * and place active threads the user has not closed. Returns `state` when nothing changed.
 */
export function reconcileLayout<S extends PlacementState & { dismissed: Record<string, true> }>(
  state: S,
  input: ReconcileInput,
): S {
  const activeKeys = new Set(input.threads.map((thread) => thread.key));
  let frames = state.frames;
  let changed = false;
  for (const frame of Object.values(state.frames)) {
    for (const item of frame.items) {
      const threadKey =
        item.kind === "draft" ? null : threadItemKey(item.environmentId, item.threadId);
      if (threadKey !== null && !activeKeys.has(threadKey) && !input.keepKeys?.has(threadKey)) {
        frames = withoutItem(frames, item.key);
        changed = true;
      }
    }
  }
  let regions = state.regions;
  for (const key of Object.keys(regions)) {
    if (!input.projectKeys.has(key)) {
      const { [key]: _removed, ...rest } = regions;
      regions = rest;
      changed = true;
    }
  }
  let placement: PlacementState = { frames, regions };
  for (const thread of input.threads) {
    if (state.dismissed[thread.key]) continue;
    if (findFrameByItemKey(placement.frames, thread.key) !== null) continue;
    placement = placeInProject(
      placement,
      {
        kind: "thread",
        key: thread.key,
        environmentId: thread.environmentId,
        threadId: thread.threadId,
      },
      thread.projectKey,
      THREAD_FRAME_SIZE,
    );
    changed = true;
  }
  let dismissed = state.dismissed;
  for (const key of Object.keys(dismissed)) {
    if (!activeKeys.has(key)) {
      const { [key]: _removed, ...rest } = dismissed;
      dismissed = rest;
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, frames: placement.frames, regions: placement.regions, dismissed };
}

/** Lay every region's panes out on a fresh grid, regions side by side, keeping tab groups. */
export function tidyLayout(state: PlacementState): PlacementState {
  const regionList = Object.values(state.regions).toSorted((a, b) => a.x - b.x || a.y - b.y);
  const assigned = new Set<string>();
  const nextRegions: Record<string, CanvasRegion> = {};
  const nextFrames: Record<string, CanvasFrame> = {};
  let cursorX = 0;
  for (const region of regionList) {
    const members = framesInRegion(state.frames, region)
      .filter((frame) => !assigned.has(frame.id))
      .toSorted((a, b) => a.y - b.y || a.x - b.x);
    const columns = Math.max(1, Math.min(REGION_COLUMNS, members.length));
    const width =
      columns * THREAD_FRAME_SIZE.width + (columns - 1) * FRAME_GAP + REGION_PADDING * 2;
    let next: CanvasRegion = {
      ...region,
      x: cursorX,
      y: 0,
      width,
      height: THREAD_FRAME_SIZE.height + REGION_HEADER_HEIGHT + REGION_PADDING * 1.5,
    };
    const area = regionContentArea(next);
    members.forEach((frame, index) => {
      assigned.add(frame.id);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rect = {
        x: area.x + column * (THREAD_FRAME_SIZE.width + FRAME_GAP),
        y: area.y + row * (THREAD_FRAME_SIZE.height + FRAME_GAP),
        width: THREAD_FRAME_SIZE.width,
        height: frame.items.some((item) => item.kind !== "terminal")
          ? THREAD_FRAME_SIZE.height
          : TERMINAL_FRAME_SIZE.height,
      };
      nextFrames[frame.id] = { ...frame, ...rect };
      next = growRegionToFit(next, rect);
    });
    nextRegions[region.key] = next;
    cursorX = next.x + next.width + REGION_GAP;
  }
  const loose = Object.values(state.frames).filter((frame) => !assigned.has(frame.id));
  loose.forEach((frame, index) => {
    nextFrames[frame.id] = {
      ...frame,
      x: cursorX + (index % REGION_COLUMNS) * (frame.width + FRAME_GAP),
      y: Math.floor(index / REGION_COLUMNS) * (THREAD_FRAME_SIZE.height + FRAME_GAP),
    };
  });
  return { frames: nextFrames, regions: nextRegions };
}

interface WorkspaceCanvasState extends PlacementState {
  view: CanvasView;
  minimapOpen: boolean;
  /** Threads the user closed; auto-place skips them until reopened. */
  dismissed: Record<string, true>;
  setView: (view: CanvasView) => void;
  reconcile: (input: ReconcileInput) => void;
  /** Put an item on the canvas if it is missing, reopening it if it was closed. */
  ensureItem: (item: CanvasItem, projectKey: string | null) => void;
  /** Add a terminal pane beside the frame holding `besideKey`. */
  addTerminalBeside: (item: Extract<CanvasItem, { kind: "terminal" }>, besideKey: string) => void;
  setFrameRect: (frameId: string, rect: Rect) => void;
  moveFrames: (frameIds: ReadonlyArray<string>, dx: number, dy: number) => void;
  bringToFront: (frameId: string) => void;
  setActiveItem: (frameId: string, key: string) => void;
  /** Remove an item; a closed thread stays off the canvas until reopened. */
  removeItem: (key: string) => void;
  closeFrame: (frameId: string) => void;
  mergeFrameInto: (sourceFrameId: string, targetFrameId: string) => void;
  detachItem: (key: string, position: Point) => void;
  replaceItem: (key: string, item: CanvasItem) => void;
  setRegionRect: (key: string, rect: Rect) => void;
  /** Move a region and the frames inside it. */
  moveRegion: (key: string, frameIds: ReadonlyArray<string>, dx: number, dy: number) => void;
  setRegionColor: (key: string, colorIndex: number) => void;
  restoreDismissed: () => void;
  tidy: () => void;
  setMinimapOpen: (open: boolean) => void;
}

function dismissItems(
  dismissed: Record<string, true>,
  items: ReadonlyArray<CanvasItem>,
): Record<string, true> {
  const threads = items.filter(isThreadLike);
  if (threads.length === 0) return dismissed;
  const next = { ...dismissed };
  for (const item of threads) next[item.key] = true;
  return next;
}

export const useWorkspaceCanvasStore = create<WorkspaceCanvasState>()(
  persist(
    (set) => ({
      frames: {},
      regions: {},
      view: DEFAULT_VIEW,
      minimapOpen: true,
      dismissed: {},
      setView: (view) => set({ view: { ...view, zoom: clampZoom(view.zoom) } }),
      reconcile: (input) => set((state) => reconcileLayout(state, input)),
      ensureItem: (item, projectKey) =>
        set((state) => {
          if (findFrameByItemKey(state.frames, item.key) !== null) {
            if (!state.dismissed[item.key]) return state;
            const { [item.key]: _removed, ...dismissed } = state.dismissed;
            return { dismissed };
          }
          const { [item.key]: _removed, ...dismissed } = state.dismissed;
          return { ...placeInProject(state, item, projectKey, THREAD_FRAME_SIZE), dismissed };
        }),
      addTerminalBeside: (item, besideKey) =>
        set((state) => {
          if (findFrameByItemKey(state.frames, item.key) !== null) return state;
          const beside = findFrameByItemKey(state.frames, besideKey);
          const id = `frame:${randomUUID()}`;
          const origin = beside
            ? findOpenGridSlot(
                {
                  x: beside.x + beside.width + FRAME_GAP,
                  y: beside.y,
                  width: TERMINAL_FRAME_SIZE.width,
                  height: beside.height,
                },
                TERMINAL_FRAME_SIZE,
                Object.values(state.frames),
                FRAME_GAP,
              )
            : { x: 0, y: 0 };
          return {
            frames: {
              ...state.frames,
              [id]: {
                id,
                ...origin,
                ...TERMINAL_FRAME_SIZE,
                z: maxZ(state.frames) + 1,
                items: [item],
                activeKey: item.key,
              },
            },
          };
        }),
      setFrameRect: (frameId, rect) =>
        set((state) => {
          const frame = state.frames[frameId];
          if (!frame) return state;
          return { frames: { ...state.frames, [frameId]: { ...frame, ...rect } } };
        }),
      moveFrames: (frameIds, dx, dy) =>
        set((state) => {
          if (frameIds.length === 0 || (dx === 0 && dy === 0)) return state;
          const frames = { ...state.frames };
          for (const id of frameIds) {
            const frame = frames[id];
            if (frame) frames[id] = { ...frame, x: frame.x + dx, y: frame.y + dy };
          }
          return { frames };
        }),
      bringToFront: (frameId) =>
        set((state) => {
          const frame = state.frames[frameId];
          const top = maxZ(state.frames);
          if (!frame || frame.z === top) return state;
          return { frames: { ...state.frames, [frameId]: { ...frame, z: top + 1 } } };
        }),
      setActiveItem: (frameId, key) =>
        set((state) => {
          const frame = state.frames[frameId];
          if (!frame || frame.activeKey === key) return state;
          if (!frame.items.some((item) => item.key === key)) return state;
          return { frames: { ...state.frames, [frameId]: { ...frame, activeKey: key } } };
        }),
      removeItem: (key) =>
        set((state) => {
          const frame = findFrameByItemKey(state.frames, key);
          if (!frame) return state;
          const item = frame.items.find((entry) => entry.key === key)!;
          return {
            frames: withoutItem(state.frames, key),
            dismissed: dismissItems(state.dismissed, [item]),
          };
        }),
      closeFrame: (frameId) =>
        set((state) => {
          const frame = state.frames[frameId];
          if (!frame) return state;
          const { [frameId]: _removed, ...frames } = state.frames;
          return { frames, dismissed: dismissItems(state.dismissed, frame.items) };
        }),
      mergeFrameInto: (sourceFrameId, targetFrameId) =>
        set((state) => {
          const source = state.frames[sourceFrameId];
          const target = state.frames[targetFrameId];
          if (!source || !target || source.id === target.id) return state;
          const { [sourceFrameId]: _removed, ...frames } = state.frames;
          frames[targetFrameId] = {
            ...target,
            items: [...target.items, ...source.items],
            activeKey: source.activeKey,
            z: maxZ(state.frames) + 1,
          };
          return { frames };
        }),
      detachItem: (key, position) =>
        set((state) => {
          const frame = findFrameByItemKey(state.frames, key);
          if (!frame || frame.items.length < 2) return state;
          const item = frame.items.find((entry) => entry.key === key)!;
          const frames = withoutItem(state.frames, key);
          const id = `frame:${randomUUID()}`;
          frames[id] = {
            id,
            ...position,
            width: frame.width,
            height: frame.height,
            z: maxZ(state.frames) + 1,
            items: [item],
            activeKey: key,
          };
          return { frames };
        }),
      replaceItem: (key, item) =>
        set((state) => {
          const frame = findFrameByItemKey(state.frames, key);
          if (!frame) return state;
          const duplicate = findFrameByItemKey(state.frames, item.key);
          const frames =
            duplicate !== null && duplicate.id !== frame.id
              ? withoutItem(state.frames, item.key)
              : { ...state.frames };
          const current = frames[frame.id] ?? frame;
          const items = current.items
            .filter((entry) => entry.key !== item.key || entry.key === key)
            .map((entry) => (entry.key === key ? item : entry));
          frames[frame.id] = {
            ...current,
            items,
            activeKey: current.activeKey === key ? item.key : current.activeKey,
          };
          return { frames };
        }),
      setRegionRect: (key, rect) =>
        set((state) => {
          const region = state.regions[key];
          if (!region) return state;
          return { regions: { ...state.regions, [key]: { ...region, ...rect } } };
        }),
      moveRegion: (key, frameIds, dx, dy) =>
        set((state) => {
          const region = state.regions[key];
          if (!region) return state;
          const frames = { ...state.frames };
          for (const id of frameIds) {
            const frame = frames[id];
            if (frame) frames[id] = { ...frame, x: frame.x + dx, y: frame.y + dy };
          }
          return {
            frames,
            regions: { ...state.regions, [key]: { ...region, x: region.x + dx, y: region.y + dy } },
          };
        }),
      setRegionColor: (key, colorIndex) =>
        set((state) => {
          const region = state.regions[key];
          if (!region) return state;
          return { regions: { ...state.regions, [key]: { ...region, colorIndex } } };
        }),
      restoreDismissed: () => set({ dismissed: {} }),
      tidy: () => set((state) => tidyLayout(state)),
      setMinimapOpen: (minimapOpen) => set({ minimapOpen }),
    }),
    {
      name: "t3code:workspace-canvas:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        frames: state.frames,
        regions: state.regions,
        view: state.view,
        minimapOpen: state.minimapOpen,
        dismissed: state.dismissed,
      }),
    },
  ),
);

interface CanvasSessionState {
  /** Frames picked with Shift; they drag together and terminals among them share input. */
  selectedFrameIds: ReadonlyArray<string>;
  /** The frame keyboard navigation and expand act on. */
  focusedFrameId: string | null;
  expandedFrameId: string | null;
  viewport: Size;
  /** True while a drag or resize runs; an overlay then keeps iframes from eating the pointer. */
  interacting: boolean;
  guides: ReadonlyArray<SnapGuide>;
  /** The frame a dragged frame would join as a tab when dropped. */
  dropTargetFrameId: string | null;
  setSelection: (frameIds: ReadonlyArray<string>) => void;
  toggleSelected: (frameId: string) => void;
  setFocusedFrameId: (frameId: string | null) => void;
  setExpandedFrameId: (frameId: string | null) => void;
  setViewport: (viewport: Size) => void;
  setInteraction: (input: {
    readonly interacting: boolean;
    readonly guides?: ReadonlyArray<SnapGuide>;
    readonly dropTargetFrameId?: string | null;
  }) => void;
}

const EMPTY_SELECTION: ReadonlyArray<string> = [];
const EMPTY_GUIDES: ReadonlyArray<SnapGuide> = [];

export const useCanvasSessionStore = create<CanvasSessionState>()((set) => ({
  selectedFrameIds: EMPTY_SELECTION,
  focusedFrameId: null,
  expandedFrameId: null,
  viewport: { width: 0, height: 0 },
  interacting: false,
  guides: EMPTY_GUIDES,
  dropTargetFrameId: null,
  setSelection: (frameIds) =>
    set({ selectedFrameIds: frameIds.length === 0 ? EMPTY_SELECTION : frameIds }),
  toggleSelected: (frameId) =>
    set((state) => ({
      selectedFrameIds: state.selectedFrameIds.includes(frameId)
        ? state.selectedFrameIds.filter((id) => id !== frameId)
        : [...state.selectedFrameIds, frameId],
    })),
  setFocusedFrameId: (focusedFrameId) =>
    set((state) => (state.focusedFrameId === focusedFrameId ? state : { focusedFrameId })),
  setExpandedFrameId: (expandedFrameId) => set({ expandedFrameId }),
  setViewport: (viewport) =>
    set((state) =>
      state.viewport.width === viewport.width && state.viewport.height === viewport.height
        ? state
        : { viewport },
    ),
  setInteraction: ({ interacting, guides, dropTargetFrameId }) =>
    set({
      interacting,
      guides: guides === undefined || guides.length === 0 ? EMPTY_GUIDES : guides,
      dropTargetFrameId: dropTargetFrameId ?? null,
    }),
}));

export const LIVE_MIN_ZOOM = 0.3;
const MAX_LIVE_FRAMES = 6;

/**
 * Frames that render their real content. The rest show a light card, so a canvas of many
 * threads costs one subscription per nearby pane, not per thread.
 */
export function selectLiveFrameIds(input: {
  readonly frames: Readonly<Record<string, CanvasFrame>>;
  readonly view: CanvasView;
  readonly viewport: Size;
  readonly pinnedFrameIds: ReadonlyArray<string | null>;
}): string[] {
  const { frames, view, viewport } = input;
  const pinned = input.pinnedFrameIds.filter(
    (id): id is string => id !== null && frames[id] !== undefined,
  );
  if (view.zoom < LIVE_MIN_ZOOM || viewport.width === 0) return pinned;
  const visible = viewportWorldRect(view, viewport);
  const center = rectCenter(visible);
  const nearby = Object.values(frames)
    .filter((frame) => rectsIntersect(frame, visible))
    .map((frame) => {
      const frameCenter = rectCenter(frame);
      return {
        id: frame.id,
        distance: Math.hypot(frameCenter.x - center.x, frameCenter.y - center.y),
      };
    })
    .toSorted((a, b) => a.distance - b.distance)
    .map((entry) => entry.id);
  const live = new Set(pinned);
  for (const id of nearby) {
    if (live.size >= MAX_LIVE_FRAMES) break;
    live.add(id);
  }
  return [...live].toSorted();
}
