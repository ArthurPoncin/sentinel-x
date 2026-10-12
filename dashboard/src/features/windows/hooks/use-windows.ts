import { useReducer } from 'react'
import { NO_WINDOWS, type WindowEvent, type Windows, windowsAfter } from '../utils/windows'

// The open windows of a screen, and where to send what opens and closes them.
export function useWindows(): [Windows, (event: WindowEvent) => void] {
  return useReducer(windowsAfter, NO_WINDOWS)
}
