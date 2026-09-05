/**
 * Route event bus for SSE (§11.5, FR-082). Every event carries routeId, eventId, timestamp, state (§19).
 * ponytail: in-memory, single process. Persist to a RouteEvent table if the API ever runs >1 instance.
 */
import { randomUUID } from 'node:crypto';
import type { RouteEvent, RouteEventType, RouteState } from '@subbuddy/contracts';

type Listener = (event: RouteEvent) => void;

export class RouteEvents {
  private readonly history = new Map<string, RouteEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

  emit(
    routeId: string,
    type: RouteEventType,
    state: RouteState,
    payload: Record<string, unknown> = {},
  ): RouteEvent {
    const event: RouteEvent = {
      eventId: randomUUID(),
      routeId,
      type,
      timestamp: new Date().toISOString(),
      state,
      payload,
    };
    const list = this.history.get(routeId) ?? [];
    list.push(event);
    this.history.set(routeId, list);
    for (const fn of this.listeners.get(routeId) ?? []) fn(event);
    return event;
  }

  replay(routeId: string): RouteEvent[] {
    return [...(this.history.get(routeId) ?? [])];
  }

  subscribe(routeId: string, fn: Listener): () => void {
    const set = this.listeners.get(routeId) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(routeId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(routeId);
    };
  }
}
