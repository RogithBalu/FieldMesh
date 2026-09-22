export type FieldType = 'pass_fail' | 'numeric' | 'notes' | 'photo';

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
 * No backend endpoint currently defines per-inspection fields (a real,
 * documented gap in the FieldMesh server), and this app is local-only, so
 * every inspection uses this one fixed checklist template. Swap this out for
 * a per-inspection-type template if/when the backend grows a real
 * field-definitions endpoint.
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
    description: 'Analog gauge reading, target 70°C ± 10.',
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
