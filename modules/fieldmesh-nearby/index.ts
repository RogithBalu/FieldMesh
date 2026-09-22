/**
 * JS binding for the FieldMeshNearby Expo module (Android, Google Nearby
 * Connections). `null` when the native module is absent (Expo Go, web), so
 * the app can explain that the offline mesh needs the installed build.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type NearbyEvents = {
  onEndpointFound: (e: { endpointId: string; name: string; serviceId: string }) => void;
  onEndpointLost: (e: { endpointId: string }) => void;
  onConnected: (e: { endpointId: string; name: string }) => void;
  onDisconnected: (e: { endpointId: string; name: string; reason: string }) => void;
  onPayload: (e: { endpointId: string; data: string }) => void;
  /** quality: 1 = low (BLE), 2 = medium (Bluetooth), 3 = high (Wi-Fi) */
  onBandwidthChanged: (e: { endpointId: string; quality: number }) => void;
};

export declare class FieldMeshNearbyNative extends NativeModule<NearbyEvents> {
  isAvailable(): boolean;
  connectedEndpoints(): { endpointId: string; name: string }[];
  startAdvertising(serviceId: string, endpointName: string): Promise<void>;
  startDiscovery(serviceId: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  stopDiscovery(): Promise<void>;
  requestConnection(endpointName: string, endpointId: string): Promise<void>;
  sendPayload(endpointId: string, base64: string): Promise<void>;
  disconnect(endpointId: string): Promise<void>;
  stopAll(): Promise<void>;
}

const FieldMeshNearby = requireOptionalNativeModule<FieldMeshNearbyNative>('FieldMeshNearby');

export default FieldMeshNearby;
