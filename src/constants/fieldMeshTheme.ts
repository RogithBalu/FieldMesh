/**
 * FieldMesh Design System Tokens
 * Extracted from Stitch project: FieldMesh Mobile Inspection App (ID: 6300323291909235654)
 * Engineered for outdoor high-lux readability and tactile industrial field workflows.
 */

export const FieldMeshColors = {
  // Surfaces
  surface: '#f9f9ff',
  surfaceBright: '#f9f9ff',
  surfaceDim: '#d3daef',
  surfaceLowest: '#ffffff',
  surfaceContainerLow: '#f1f3ff',
  surfaceContainer: '#e9edff',
  surfaceContainerHigh: '#e1e8fd',
  surfaceContainerHighest: '#dce2f7',
  inverseSurface: '#293040',
  inverseOnSurface: '#edf0ff',

  // Text & Boundaries
  onSurface: '#141b2b',
  onSurfaceVariant: '#464553',
  outline: '#777584',
  outlineVariant: '#c8c4d5',

  // Primary Brand (Industrial Deep Indigo)
  primary: '#1f108e',
  primaryContainer: '#3730a3',
  primaryPress: '#4338ca',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#a9a7ff',
  primaryFixed: '#e2dfff',
  primaryFixedDim: '#c3c0ff',
  onPrimaryFixed: '#0f0069',

  // Secondary (High-Visibility Safety Green)
  secondary: '#006d30',
  secondaryContainer: '#92f5a4',
  secondaryFixed: '#95f8a7',
  secondaryFixedDim: '#79db8d',
  onSecondary: '#ffffff',
  onSecondaryContainer: '#007233',
  onSecondaryFixed: '#00210a',

  // Error / Defect / Fail (Safety Red)
  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  onError: '#ffffff',
  onErrorContainer: '#93000a',

  // Tertiary / Conflict / Warning (Amber)
  tertiary: '#4e1f00',
  tertiaryContainer: '#703000',
  tertiaryFixed: '#ffdbca',
  tertiaryFixedDim: '#ffb68e',
  onTertiary: '#ffffff',
  onTertiaryContainer: '#ff9454',
  onTertiaryFixed: '#331200',
  onTertiaryFixedVariant: '#763300',
} as const;

export const FieldMeshSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  gutter: 16,
} as const;

export const FieldMeshRadius = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const FieldMeshTypography = {
  displayLg: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700' as const,
  },
  headlineLg: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700' as const,
  },
  headlineMd: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600' as const,
  },
  headlineSm: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  bodyLg: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500' as const,
  },
  bodyMd: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
  },
  bodySm: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  labelLg: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  labelMd: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  dataDisplay: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600' as const,
  },
  dataMono: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500' as const,
  },
} as const;
