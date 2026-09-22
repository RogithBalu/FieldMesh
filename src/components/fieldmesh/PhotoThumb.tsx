import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { FieldMeshColors, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from './FieldMeshIcon';
import { getPhotoMeta, serverPhotoSource } from '@/lib/photos';

/**
 * Renders a photo by hash: the local file if this device took it, otherwise
 * GET /photos/:hash from the server (authenticated). Falls back between them.
 */
export function PhotoThumb({ hash, size = 76, style }: { hash: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [triedLocal, setTriedLocal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPhotoMeta(hash).then((meta) => {
      if (cancelled) return;
      setFailed(false);
      if (meta?.uri) {
        setTriedLocal(true);
        setSource({ uri: meta.uri });
      } else {
        setTriedLocal(false);
        setSource(serverPhotoSource(hash));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  const onError = () => {
    if (triedLocal) {
      // Local file gone (cache cleared) — fall back to the server copy.
      setTriedLocal(false);
      setSource(serverPhotoSource(hash));
    } else {
      setFailed(true);
    }
  };

  return (
    <View style={[styles.box, { width: size, height: size }, style]}>
      {source && !failed ? (
        <Image source={source} style={styles.img} onError={onError} />
      ) : (
        <FieldMeshIcon name={failed ? 'cloud_off' : 'photo_camera'} size={22} color={FieldMeshColors.outline} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: FieldMeshRadius.md,
    overflow: 'hidden',
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
});
