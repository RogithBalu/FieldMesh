import type { FieldType } from '@/lib/editlog/types';

export interface ChecklistField {
  fieldId: string;
  code: string;
  title: string;
  description: string;
  type: FieldType;
  unit?: string;
  tolerance?: number;
  target?: number;
  range?: string;
}

/**
 * The default checklist sent to the server as `fields` when an inspection is
 * created (POST /inspections). The server stores them in field_defs so its
 * dispute engine applies the right merge rule and tolerance per field, and
 * returns them from GET /inspections/:id. Inspections created before field
 * definitions existed on the server fall back to this template client-side.
 */
export const CHECKLIST_TEMPLATE: ChecklistField[] = [
  {
    fieldId: 'insulation_condition',
    code: 'CRIT-01',
    title: 'Insulation Condition',
    description: 'Inspect main dielectric barrier for cracking, tracking, or oil saturation.',
    type: 'pass_fail',
  },
  {
    fieldId: 'oil_temperature',
    code: 'SENS-04',
    title: 'Oil Temperature',
    description: 'Analog gauge reading. Two readings within ±10°C of each other are not a dispute.',
    type: 'numeric',
    unit: '°C',
    tolerance: 10,
    target: 70,
    range: 'Normal: 60–80°C',
  },
  {
    fieldId: 'terminal_seal_notes',
    code: 'NOTE-02',
    title: 'Bushing Terminal Seals',
    description: 'High-voltage gasket degradation check — free-text field notes.',
    type: 'notes',
  },
  {
    fieldId: 'pressure_relief_photo',
    code: 'PHOTO-01',
    title: 'Pressure Relief Device',
    description: 'Physical indicator pin alignment — attach a photo.',
    type: 'photo',
  },
];

export function templateDefs(): Record<string, { type: FieldType; tolerance?: number }> {
  const out: Record<string, { type: FieldType; tolerance?: number }> = {};
  for (const f of CHECKLIST_TEMPLATE) out[f.fieldId] = { type: f.type, tolerance: f.tolerance };
  return out;
}

/** Shape POST /inspections expects in `fields`. */
export function templateFieldDefs(): { id: string; type: FieldType; tolerance?: number }[] {
  return CHECKLIST_TEMPLATE.map((f) => ({ id: f.fieldId, type: f.type, tolerance: f.tolerance }));
}
