// PLACEHOLDER: declare the $.state values under the mod's name.
export type Turns = { count: number }

declare module 'claude-code' {
  interface PluginState {
    'effort-guard': { turns: Turns }
  }
}
