import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

interface FieldMeshIconProps {
  name: string;
  size?: number;
  color?: string;
}

// Map common Google Material Symbols names to MaterialIcons
const ICON_MAP: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  arrow_back: 'arrow-back',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  person: 'person',
  check: 'check',
  check_circle: 'check-circle',
  cancel: 'cancel',
  close: 'close',
  warning: 'warning',
  info: 'info',
  info_outline: 'info-outline',
  schedule: 'schedule',
  calendar_today: 'calendar-today',
  location_on: 'location-on',
  cloud_queue: 'cloud-queue',
  sync: 'sync',
  add: 'add',
  remove: 'remove',
  edit: 'edit',
  edit_note: 'edit-note',
  photo_camera: 'photo-camera',
  add_a_photo: 'add-a-photo',
  qr_code_scanner: 'qr-code-scanner',
  content_copy: 'content-copy',
  sensors: 'sensors',
  shield: 'shield',
  swap_horiz: 'swap-horiz',
  verified: 'verified',
  verified_user: 'verified-user',
  badge: 'badge',
  dialpad: 'dialpad',
  lock: 'lock',
  lock_outline: 'lock-outline',
  visibility: 'visibility',
  visibility_off: 'visibility-off',
  contactless: 'contactless',
  bolt: 'bolt',
  save: 'save',
  database: 'storage',
  rule: 'gavel',
  gpp_maybe: 'security',
  login: 'login',
  arrow_forward: 'arrow-forward',
  phone_android: 'phone-android',
  fingerprint: 'fingerprint',
  mail: 'mail-outline',
  mail_outline: 'mail-outline',
  email: 'email',
  east: 'east',
  hub: 'hub',
  settings: 'settings',
  person_add: 'person-add',
  expand_less: 'expand-less',
  expand_more: 'expand-more',
  logout: 'logout',
  history: 'history',
  refresh: 'refresh',
  cloud_done: 'cloud-done',
  cloud_off: 'cloud-off',
  cloud_upload: 'cloud-upload',
  wifi: 'wifi',
  wifi_off: 'wifi-off',
  photo_library: 'photo-library',
  description: 'description',
  groups: 'groups',
  link: 'link',
  sync_problem: 'sync-problem',
  sync_disabled: 'sync-disabled',
  dns: 'dns',
  devices: 'devices',
  delete: 'delete',
  keyboard: 'keyboard',
};

export const FieldMeshIcon: React.FC<FieldMeshIconProps> = ({
  name,
  size = 20,
  color = '#141b2b',
}) => {
  const iconName = ICON_MAP[name] || (name as keyof typeof MaterialIcons.glyphMap) || 'circle';
  return <MaterialIcons name={iconName} size={size} color={color} />;
};
