/**
 * Bun Build Config - similar API to tsup
 * Provides a configuration structure for Bun-based builds
 */

export interface BunBuildConfig {
  entry: string[]
  format: ('esm' | 'cjs')[]
  dts?: boolean
  sourcemap?: boolean
  clean?: boolean
  outDir: string
  noExternal?: string[]
  splitting?: boolean
  minify?: boolean
  target?: string
  skipNodeModulesBundle?: boolean
  bundle?: boolean
  shims?: boolean
  tsconfig?: string
  onSuccess?: string
  banner?: (opts: { format: string }) => { js: string }
  external?: string[]
  copy?: Array<{
    from: string[]
    to: string[]
  }>
}

export interface BuildOptions {
  watch?: boolean
}

/**
 * Define a build configuration that can be used with bun-build.ts
 * Similar to tsup's defineConfig
 */
export function defineConfig(
  configFn: (options: BuildOptions) => BunBuildConfig,
): (options: BuildOptions) => BunBuildConfig {
  return configFn
}
