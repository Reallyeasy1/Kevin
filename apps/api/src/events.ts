/**
 * Route event bus for SSE (§11.5, FR-082). Every event carries routeId, eventId, timestamp, state, and the
 * §19 correlation ids (requestId, offerId, invoiceId, transactionHash) once known, merged into the payload
 * so the §11.5 wire shape is unchanged.
 * ponytail: in-memory, single process. Persist to a RouteEvent table if the API ever runs >1 instance.
 */
import { randomUUID } from 'node:crypto';
import type { RouteEvent, RouteEventType, RouteState } from '@subbuddy/contracts';

type Listener = (event: RouteEvent) => void;

/** §19 correlation ids; each is set once it exists and stamped on every later event. */
export interface Correlation {
  requestId?: string;
  offerId?: string;
  invoiceId?: string;
  transactionHash?: string;
}

export class RouteEvents {
  private readonly history = new Map<string, RouteEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly correlation = new Map<string, Correlation>();

  /** Merge known ids for a route; subsequent emits carry them (§19). */
  correlate(routeId: string, ids: Correlation): Correlation {
    const merged = { ...this.correlation.get(routeId), ...ids };
    this.correlation.set(routeId, merged);
    return merged;
  }

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
      payload: { ...this.correlation.get(routeId), ...payload },
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
