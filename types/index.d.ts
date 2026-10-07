export type RtlEnabled = boolean

declare module 'claude-code' {
  interface PluginState {
    'hebrew-rtl-ubuntu': { isEnabled: RtlEnabled }
  }
}
