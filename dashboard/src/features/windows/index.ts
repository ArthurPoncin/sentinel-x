// Public API of the windows feature: import from '@/features/windows', never from its folders.
export { GlassWindows, type GlassWindowsProps } from './components/glass-windows'
export { useWindows } from './hooks/use-windows'
// Pure, for whoever opens and closes the windows.
export {
  isOpen,
  NO_WINDOWS,
  type OpenWindow,
  type Opener,
  SLOTS,
  type Slot,
  WINDOW_IDS,
  WINDOWS,
  type WindowEvent,
  type WindowId,
  type Windows,
  windowsAfter,
} from './utils/windows'
