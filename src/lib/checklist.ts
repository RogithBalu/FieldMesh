import { CHECKLIST_TEMPLATE, type ChecklistField } from '@/constants/checklistTemplate';
import type { FieldDefs } from './useInspectionDoc';

/** Field ids beginning with "_" are metadata (e.g. resolution notes) and are hidden from the checklist. */
export const RESOLUTION_NOTES_FIELD = '_resolution_notes';

export function isHiddenField(fieldId: string): boolean {
  return fieldId.startsWith('_');
}

/**
 * The items to render: template metadata for known ids (in template order),
 * then any extra fields the server defined that the template doesn't know.
 */
export function buildChecklist(defs: FieldDefs): ChecklistField[] {
  const known = new Set<string>();
  const out: ChecklistField[] = [];
  for (const f of CHECKLIST_TEMPLATE) {
    if (defs[f.fieldId]) {
      out.push({ ...f, type: defs[f.fieldId].type, tolerance: defs[f.fieldId].tolerance ?? f.tolerance });
      known.add(f.fieldId);
    }
  }
  for (const [fieldId, def] of Object.entries(defs)) {
    if (known.has(fieldId) || isHiddenField(fieldId)) continue;
    out.push({
      fieldId,
      code: fieldId.slice(0, 8).toUpperCase(),
      title: fieldId.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `${def.type.replace('_', '/')} field`,
      type: def.type,
      tolerance: def.tolerance,
    });
  }
  return out;
}

export function fieldTitle(fieldId: string): string {
  if (fieldId === RESOLUTION_NOTES_FIELD) return 'Resolution notes';
  return (
    CHECKLIST_TEMPLATE.find((f) => f.fieldId === fieldId)?.title ??
    fieldId.replace(/^_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
}

export function relativeTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Display form of a stored field value: verdicts uppercase, everything else as-is. */
export function displayValue(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  return v === 'pass' || v === 'fail' ? v.toUpperCase() : v;
}
