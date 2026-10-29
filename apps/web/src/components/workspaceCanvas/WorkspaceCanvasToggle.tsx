import { useAtomValue } from "@effect/atom-react";
import { LayoutDashboardIcon } from "lucide-react";
import { use } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CanvasFrameContext, setWorkspaceCanvasEnabled } from "./canvasToggle";

/** Header switch between the single-thread view and the canvas; panes on the canvas omit it. */
export function WorkspaceCanvasToggle() {
  const insideCanvas = use(CanvasFrameContext) !== null;
  const enabled = useClientSettings((settings) => settings.workspaceCanvasEnabled);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  if (insideCanvas) return null;
  const shortcutLabel = shortcutLabelForCommand(keybindings, "canvas.toggle");
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Toggle
          className="shrink-0 [-webkit-app-region:no-drag]"
          pressed={enabled}
          onPressedChange={(pressed) => void setWorkspaceCanvasEnabled(pressed)}
          aria-label="Toggle canvas view"
          variant="ghost"
          size="sm"
        >
          <LayoutDashboardIcon className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {enabled ? "Back to thread view" : "Open canvas view"}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}
