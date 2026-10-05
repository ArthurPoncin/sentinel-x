import type { StatusLevel } from '@/shared/contract'

// The color of each Status, defined here and nowhere else. The stylesheet gets them as --nominal, --elevated
// and --critical (main.tsx hands them over), the Twin lights its scene with them.
export const STATUS_COLORS: Readonly<Record<StatusLevel, string>> = {
  nominal: '#3ecf8e',
  elevated: '#f5a623',
  critical: '#ff4d4f',
}
