export type BodyMetricKey =
  | 'weight' | 'neck' | 'chest' | 'abdomen' | 'waist' | 'hips'
  | 'armLeft' | 'armRight' | 'thighLeft' | 'thighRight' | 'calfLeft' | 'calfRight';

export interface BodyMetricDef {
  key: BodyMetricKey;
  label: string;
  unit: 'kg' | 'cm';
  color: string;
}

export const BODY_METRIC_DEFS: BodyMetricDef[] = [
  { key: 'weight',     label: 'Poids',         unit: 'kg', color: '#f472b6' },
  { key: 'chest',      label: 'Poitrine',       unit: 'cm', color: '#a78bfa' },
  { key: 'waist',      label: 'Taille',         unit: 'cm', color: '#34d399' },
  { key: 'hips',       label: 'Hanches',        unit: 'cm', color: '#fb923c' },
  { key: 'abdomen',    label: 'Abdomen',        unit: 'cm', color: '#60a5fa' },
  { key: 'neck',       label: 'Cou',            unit: 'cm', color: '#fbbf24' },
  { key: 'armLeft',    label: 'Bras gauche',    unit: 'cm', color: '#f87171' },
  { key: 'armRight',   label: 'Bras droit',     unit: 'cm', color: '#fb7185' },
  { key: 'thighLeft',  label: 'Cuisse gauche',  unit: 'cm', color: '#818cf8' },
  { key: 'thighRight', label: 'Cuisse droite',  unit: 'cm', color: '#6366f1' },
  { key: 'calfLeft',   label: 'Mollet gauche',  unit: 'cm', color: '#2dd4bf' },
  { key: 'calfRight',  label: 'Mollet droit',   unit: 'cm', color: '#14b8a6' },
];

export const ALL_BODY_METRIC_KEYS: BodyMetricKey[] = BODY_METRIC_DEFS.map(d => d.key);

export interface BodyMeasurement {
  id: number;
  date: string;        // YYYY-MM-DD
  weight?: number;     // kg
  neck?: number;       // cm
  chest?: number;      // cm
  abdomen?: number;    // cm
  waist?: number;      // cm
  hips?: number;       // cm
  armLeft?: number;    // cm
  armRight?: number;   // cm
  thighLeft?: number;  // cm
  thighRight?: number; // cm
  calfLeft?: number;   // cm
  calfRight?: number;  // cm
  createdAt: string;
}

export interface BodySettings {
  hasPassword: boolean;
  height?: number;          // cm, for BMI
  targetWeight?: number;
  targetNeck?: number;
  targetChest?: number;
  targetAbdomen?: number;
  targetWaist?: number;
  targetHips?: number;
  targetArmLeft?: number;
  targetArmRight?: number;
  targetThighLeft?: number;
  targetThighRight?: number;
  targetCalfLeft?: number;
  targetCalfRight?: number;
  enabledMetrics: BodyMetricKey[];
}
