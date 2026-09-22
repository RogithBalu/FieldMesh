export type TransportStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export interface Transport {
  /** Identifier: "tcp" | "nearby" | "qr" | "cloud" */
  readonly name: string;

  /** Send raw bytes. Throws if not open. */
  send(bytes: Uint8Array): Promise<void>;

  /** Called for every complete frame received. */
  onReceive(handler: (bytes: Uint8Array) => void): void;

  /** Called on every status change. */
  onStatus(handler: (status: TransportStatus, detail?: string) => void): void;

  /** Open the transport (connect, advertise, etc). */
  open(): Promise<void>;

  /** Close gracefully. */
  close(): Promise<void>;
}
