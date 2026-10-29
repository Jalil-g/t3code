import { createContext } from "react";

import { getClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { registerCommands } from "../../shortcuts/dispatcher";

/** The id of the canvas frame a component renders in, or null outside the canvas. */
export const CanvasFrameContext = createContext<string | null>(null);

export function setWorkspaceCanvasEnabled(enabled: boolean): Promise<void> {
  return updateClientSettings({ workspaceCanvasEnabled: enabled });
}

function toggleWorkspaceCanvas(): Promise<void> {
  return setWorkspaceCanvasEnabled(!getClientSettings().workspaceCanvasEnabled);
}

/** The toggle lives with the app shell so it works with the canvas on or off. */
export function registerWorkspaceCanvasToggleCommand(): () => void {
  return registerCommands({
    "canvas.toggle": (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      void toggleWorkspaceCanvas();
    },
  });
}
