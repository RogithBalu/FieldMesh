/**
 * JS binding for the FieldMeshHotspot Expo module (Android): local-only
 * hotspot, Wi-Fi join, plain TCP server/client byte pipes, hub foreground
 * service. `null` when the native module is absent (Expo Go, web).
 */
import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type HotspotEvents = {
  onHotspotStopped: (e: { reason: string }) => void;
  onWifiLost: (e: { ssid: string }) => void;
  onClientConnected: (e: { clientId: string; remote: string }) => void;
  onClientDisconnected: (e: { clientId: string }) => void;
  onServerData: (e: { clientId: string; data: string }) => void;
  onData: (e: { connId: string; data: string }) => void;
  onDisconnected: (e: { connId: string }) => void;
};

export declare class FieldMeshHotspotNative extends NativeModule<HotspotEvents> {
  isSupported(): boolean;
  startHotspot(): Promise<{ ssid: string; passphrase: string; ip: string }>;
  stopHotspot(): Promise<void>;
  getHotspotIp(): string;
  /** Active access-point interface (tethering or local-only hotspot), if any. */
  getApInterface(): { name: string; ip: string } | null;
  joinWifi(ssid: string, passphrase: string, timeoutMs: number): Promise<{ bound: boolean }>;
  leaveWifi(): Promise<void>;
  startServer(port: number): Promise<{ port: number }>;
  stopServer(): Promise<void>;
  sendToClient(clientId: string, base64: string): Promise<void>;
  disconnectClient(clientId: string): Promise<void>;
  connect(host: string, port: number, timeoutMs: number): Promise<string>;
  send(connId: string, base64: string): Promise<void>;
  disconnect(connId: string): Promise<void>;
  startHubService(text: string): Promise<void>;
  stopHubService(): Promise<void>;
}

const FieldMeshHotspot = requireOptionalNativeModule<FieldMeshHotspotNative>('FieldMeshHotspot');

export default FieldMeshHotspot;
