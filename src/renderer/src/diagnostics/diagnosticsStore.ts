import { create } from 'zustand'

interface DiagnosticsState {
  debugMode: boolean
  setDebugMode: (enabled: boolean) => void
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  debugMode: false,
  setDebugMode: (enabled) => set({ debugMode: enabled }),
}))
