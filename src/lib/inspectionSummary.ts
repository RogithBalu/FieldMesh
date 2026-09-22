import * as Y from 'yjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EditLog, FIELDS_MAP } from './editlog/editLog';
import { CHECKLIST_TEMPLATE } from '@/constants/checklistTemplate';

export interface InspectionSummary {
  completed: number;
  total: number;
  disputedCount: number;
}

/** One-off read of a persisted inspection doc, for list-screen summaries. */
export async function readInspectionSummary(inspectionId: string): Promise<InspectionSummary> {
  const total = CHECKLIST_TEMPLATE.length;
  const raw = await AsyncStorage.getItem(`fieldmesh:doc:${inspectionId}`);
  if (!raw) return { completed: 0, total, disputedCount: 0 };

  const doc = new Y.Doc();
  try {
    const binary = globalThis.atob(raw);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    Y.applyUpdate(doc, buf);

    const fields = doc.getMap(FIELDS_MAP);
    const completed = CHECKLIST_TEMPLATE.filter((f) => fields.has(f.fieldId)).length;

    const editLog = new EditLog(doc, { deviceId: 'summary', author: 'summary' });
    const disputedCount = editLog.disputedFields().length;

    return { completed, total, disputedCount };
  } finally {
    doc.destroy();
  }
}
