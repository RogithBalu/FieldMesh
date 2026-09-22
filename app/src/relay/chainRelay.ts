/**
 * Chain relay — extending a site session past the hotspot's radio range.
 *
 * A phone too far from the hub to join its Wi-Fi can still reach a phone that
 * is in range. That middle phone becomes a bridge: a spoke on its uplink, a hub
 * on its downlinks.
 *
 *   hub ──Wi-Fi── bridge ──Nearby── far phone
 *
 * The relaying itself needs no forwarding code. Every link gets its own YjsSync
 * over one shared Y.Doc, and YjsSync's echo guard is per instance: an update
 * arriving on the uplink is applied with that instance as its origin, so every
 * *other* instance still sees it as foreign and sends it on. Updates therefore
 * cross the bridge in both directions by construction.
 *
 * That also makes loops safe, which a hand-written forwarder would not. Yjs
 * updates are idempotent and carry their own causality, so a message arriving
 * twice by different paths applies once and produces no new update to forward —
 * the propagation dies out instead of circulating. No TTL or seen-set needed.
 */

import * as Y from 'yjs';
import {Transport} from '../transports/types';
import {YjsSync} from '../transports/yjsSync';

export type LinkRole = 'uplink' | 'downlink';

export interface RelayLink {
  id: string;
  role: LinkRole;
  transport: Transport;
  sync: YjsSync;
}

export interface ChainRelayOptions {
  onLinkChange?: (links: ReadonlyArray<RelayLink>) => void;
}

/**
 * Holds every link this device has into one session and keeps them on a single
 * document. A device with only an uplink is an ordinary spoke; add a downlink
 * and it becomes a bridge, with no change to how either link works.
 */
export class ChainRelay {
  private readonly doc: Y.Doc;
  private readonly onLinkChange?: (links: ReadonlyArray<RelayLink>) => void;
  private readonly links = new Map<string, RelayLink>();

  constructor(doc: Y.Doc, options: ChainRelayOptions = {}) {
    this.doc = doc;
    this.onLinkChange = options.onLinkChange;
  }

  /** Every currently attached link. */
  get all(): ReadonlyArray<RelayLink> {
    return [...this.links.values()];
  }

  get uplink(): RelayLink | undefined {
    return this.all.find((l) => l.role === 'uplink');
  }

  get downlinks(): ReadonlyArray<RelayLink> {
    return this.all.filter((l) => l.role === 'downlink');
  }

  /** True once this device is carrying traffic for someone else. */
  get isBridging(): boolean {
    return this.uplink !== undefined && this.downlinks.length > 0;
  }

  /**
   * Attach a link and start syncing over it.
   * Re-attaching the same id replaces the old link, so a reconnect on the same
   * peer doesn't leave a dead YjsSync listening on the document.
   */
  add(id: string, role: LinkRole, transport: Transport): RelayLink {
    this.remove(id);

    const sync = new YjsSync(this.doc, transport);
    const link: RelayLink = {id, role, transport, sync};
    this.links.set(id, link);
    sync.start();

    this.onLinkChange?.(this.all);
    return link;
  }

  remove(id: string): void {
    const existing = this.links.get(id);
    if (!existing) {
      return;
    }
    existing.sync.stop();
    this.links.delete(id);
    this.onLinkChange?.(this.all);
  }

  /** Detach everything, e.g. when leaving the site. */
  stop(): void {
    for (const link of this.links.values()) {
      link.sync.stop();
    }
    this.links.clear();
    this.onLinkChange?.(this.all);
  }
}
