export type FieldType =
  | "pass_fail"
  | "numeric"
  | "notes"
  | "photo"
  | "short_text";

export interface FieldDef {
  id: string;
  type: FieldType;
  label: string;
  tolerance?: number;
  unit?: string;
}

export interface ChecklistSchema {
  version: number;
  fields: FieldDef[];
}
