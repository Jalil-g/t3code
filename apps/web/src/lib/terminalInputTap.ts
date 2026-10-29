export interface TerminalInputEvent {
  readonly environmentId: string;
  readonly threadId: string;
  readonly terminalId: string;
  readonly data: string;
}

type Listener = (event: TerminalInputEvent) => void;

const listeners = new Set<Listener>();

/** Hear keyboard input typed into any terminal; the canvas mirrors it to selected terminals. */
export function tapTerminalInput(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitTerminalInput(event: TerminalInputEvent): void {
  for (const listener of listeners) listener(event);
}
