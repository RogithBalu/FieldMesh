import { useSyncExternalStore } from 'react';
import { getMeshState, subscribeMesh, type MeshState } from './meshSession';

export function useMesh(): MeshState {
  return useSyncExternalStore(subscribeMesh, getMeshState, getMeshState);
}
