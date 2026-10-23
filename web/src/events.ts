// Typed subscriptions to server events: on("hello", (ev) => …) gives `ev` the HelloEvent type.
import type { ServerEvent } from "./protocol.gen";

export type EventType = ServerEvent["type"];
export type EventOf<T extends EventType> = Extract<ServerEvent, { type: T }>;
type Handler = (ev: ServerEvent) => void;

const handlers = new Map<EventType, Set<Handler>>();

export function on<T extends EventType>(type: T, fn: (ev: EventOf<T>) => void): () => void {
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  set.add(fn as Handler);
  return () => set!.delete(fn as Handler);
}

export function dispatch(ev: ServerEvent): void {
  for (const fn of handlers.get(ev.type) ?? []) {
    try { fn(ev); } catch (e) { console.error(`handler for ${ev.type}`, e); } // one bad handler never stops the rest
  }
}
