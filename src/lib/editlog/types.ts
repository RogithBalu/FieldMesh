/** Mirrors shared/src/editlog/types.ts and shared/src/schema.ts on the server. */
export interface EditEntry<T = unknown> {
  id: string;
  fieldId: string;
  value: T;
  author: string;
  device: string;
  hlc: string;
  parents: string[];
  schemaVersion: number;
  disputed?: boolean;
}

export type FieldType = 'pass_fail' | 'numeric' | 'notes' | 'photo' | 'short_text';

export interface FieldDef {
  id: string;
  type: FieldType;
  label: string;
  tolerance?: number;
  unit?: string;
}
