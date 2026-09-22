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
