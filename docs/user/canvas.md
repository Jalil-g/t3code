# Canvas view

The canvas lays your active threads out as panes on a surface you can pan and zoom. Each project
gets a colored region, and a thread's terminals can sit beside it as their own panes. Turn it off
to return to the usual one-thread view; your layout is kept for next time.

The canvas is in Labs and available on web and desktop. The mobile app keeps its own layout.

## Turning it on

Use the canvas button in a thread's header, press `Mod+Alt+G`, or open **Settings** > **Labs** and
turn on **Canvas view**. Every unarchived thread appears in its project's region. Archiving a
thread removes its pane; opening one from the sidebar brings it back.

## Working on the canvas

- **Focus.** The thread you open is the focused pane, and only it takes typing and shortcuts.
  Click any pane, or pick a thread in the sidebar, to focus it and bring it into view.
- **Move around.** Drag empty space or scroll to pan. Hold `Ctrl` or `Cmd` while scrolling, or
  pinch, to zoom. **Fit** shows every pane. The minimap jumps to any spot.
- **Arrange.** Drag a pane by its title bar; it snaps to nearby panes, and holding `Alt` turns
  snapping off. Drop a pane on another's title bar to make tabs. Drag a region's title bar to move
  the region and everything in it. **Tidy up** lays every region out on a fresh grid.
- **Terminals.** The terminal button in a thread's title bar opens a terminal pane beside it.
- **Type into several terminals.** Shift-click terminal panes, or Shift-drag across empty space,
  to select them. Typing in one selected terminal goes to all of them. `Esc` clears the selection.
- **Full view.** Double-click a title bar or press `Mod+Alt+F` to fill the canvas with one pane.

Closed panes stay off the canvas until you reopen them from the sidebar or with **Show closed**.

Panes far away or zoomed far out show a summary card instead of the live thread, which keeps a
large canvas fast. Zoom in or focus a pane to load it.

Canvas shortcuts can be changed in **Settings** > **Keybindings**.
