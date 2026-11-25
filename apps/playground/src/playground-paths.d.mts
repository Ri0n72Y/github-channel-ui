export interface PlaygroundPlugin {
  readonly slug: string
  readonly name: string
  readonly summary: string
  readonly initialPath: string
}
export declare const PLAYGROUND_PLUGINS: readonly PlaygroundPlugin[]
export declare function resolvePlaygroundPath(pathname: string):
  | { readonly kind: 'home' | 'catalog' | 'not-found' | 'resource' }
  | { readonly kind: 'plugin'; readonly plugin: PlaygroundPlugin; readonly basename: string }
