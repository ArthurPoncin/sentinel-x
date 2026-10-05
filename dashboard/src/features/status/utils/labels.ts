import type { StatusLevel } from '@/shared/contract'

export const STATUS_LABEL: Record<StatusLevel, string> = {
  nominal: 'Nominal',
  elevated: 'Elevated',
  critical: 'Critical',
}

export const STATUS_MEANING: Record<StatusLevel, string> = {
  nominal: 'No threat under way',
  elevated: 'A warning needs watching',
  critical: 'Act now',
}
