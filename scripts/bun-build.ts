#!/usr/bin/env bun
/**
 * Bun Build System - Similar to tsup
 *
 * Usage:
 *   bun scripts/bun-build.ts                  # Build from build.config.ts
 *   bun scripts/bun-build.ts --watch          # Watch mode
 *   bun scripts/bun-build.ts --config <file>  # Use custom config
 *
 * Config file should export a function from defineConfig()
 */

import { watch as watchFs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, file, spawn, write } from 'bun'

interface BuildConfig {
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

interface BuildOptions {
  watch?: boolean
  config?: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function cleanDir(dir: string) {
  try {
    await spawn(['rm', '-rf', dir]).exited
  } catch {
    // ignore
  }
}

async function copyAssets(
  assets: Array<{
    from: string[]
    to: string[]
  }>,
  appDir: string,
  outDir: string,
) {
  for (const asset of assets) {
    for (let i = 0; i < asset.from.length; i++) {
      const pattern = asset.from[i]
      const dest = asset.to[i] ?? asset.to[0]

      if (!pattern || !dest) {
        continue
      }

      // Source path is relative to appDir
      const fromPath = path.resolve(appDir, pattern)

      // Destination path is relative to outDir
      const toPath = path.resolve(outDir, dest)

      try {
        if (pattern.includes('*')) {
          // Use shell for copying with glob support
          await spawn([
            'sh',
            '-c',
            `mkdir -p ${toPath} && cp -r ${fromPath} ${toPath} 2>/dev/null || true`,
          ]).exited
        } else {
          // Single file copy
          const source = file(fromPath)
          if (await source.exists()) {
            const destDir = path.dirname(toPath)
            await spawn(['mkdir', '-p', destDir]).exited
            await spawn(['cp', fromPath, toPath]).exited
          }
        }
      } catch {
        // ignore errors
      }
    }
  }
}

async function buildWithBun(
  config: BuildConfig,
  options: { watch?: boolean; appDir: string },
) {
  const isDev = options.watch ?? false
  const appDir = options.appDir

  // Log start
  if (!isDev) {
    console.log('🔨 Building with bun...')
  }

  // Clean output directory
  if (config.clean !== false) {
    await cleanDir(config.outDir)
  }

  // Build for each format
  for (const format of config.format) {
    for (const entryFile of config.entry) {
      const entryPath = path.resolve(appDir, entryFile)

      // Get banner
      const bannerFn = config.banner
      const bannerText = bannerFn?.({ format })

      try {
        const result = await build({
          entrypoints: [entryPath],
          outdir: config.outDir,
          minify: isDev
            ? false
            : {
                keepNames: true,
              },
          sourcemap: isDev
            ? config.sourcemap
              ? 'inline'
              : 'none'
            : 'external',
          target: 'bun',
          external: config.external || [],
          format: format === 'cjs' ? 'cjs' : 'esm',
          splitting: config.splitting ?? false,
          naming: {
            entry: '[dir]/[name].js',
            chunk: '[dir]/[name]-[hash].js',
            asset: '[dir]/[name]-[hash][ext]',
          },
        })

        if (!result.success) {
          console.error('❌ Build failed')
          for (const msg of result.logs) {
            console.error(msg)
          }
          process.exit(1)
        }

        // Add banner to output files
        if (bannerText?.js) {
          const outFile = path.resolve(
            config.outDir,
            `${path.basename(entryFile, '.ts')}.js`,
          )
          try {
            const f = file(outFile)
            const content = await f.text()
            await write(outFile, `${bannerText.js}\n${content}`)
          } catch {
            // file might not exist in certain scenarios
          }
        }

        if (!isDev) {
          console.log(`✓ Built ${format.toUpperCase()} to ${config.outDir}`)
        }
      } catch (err) {
        console.error('❌ Build failed:', err)
        process.exit(1)
      }
    }
  }

  // Copy assets in non-dev mode (relative to outDir, not appDir)
  if (!isDev && config.copy?.length) {
    await copyAssets(config.copy, appDir, config.outDir)
    console.log('✓ Assets copied')
  }

  // Run onSuccess hook
  if (config.onSuccess && !isDev) {
    try {
      const proc = spawn(['sh', '-c', config.onSuccess], {
        cwd: appDir,
      })
      await proc.exited
    } catch (err) {
      console.error('Error running onSuccess:', err)
    }
  }

  if (!isDev) {
    console.log('✅ Build complete!')
  }
}

async function setupWatcher(
  _config: BuildConfig,
  appDir: string,
  onBuild: () => Promise<void>,
) {
  const watchDirs = [
    path.resolve(appDir, 'src'),
    path.resolve(appDir, '../../libs'),
  ]

  console.log('👀 Watching for changes...')

  const watchers: ReturnType<typeof watchFs>[] = []
  let buildInProgress = false

  const triggerBuild = async () => {
    if (buildInProgress) {
      return
    }
    buildInProgress = true
    try {
      await onBuild()
    } finally {
      buildInProgress = false
    }
  }

  for (const dir of watchDirs) {
    try {
      const watcher = watchFs(
        dir,
        { recursive: true, persistent: true },
        (_eventType, filename) => {
          if (filename?.endsWith('.ts') || filename?.endsWith('.tsx')) {
            // debounce
            triggerBuild()
          }
        },
      )
      watchers.push(watcher)
    } catch {
      // directory might not exist
    }
  }

  // Keep process alive
  return new Promise<void>(resolve => {
    process.on('SIGINT', () => {
      watchers.forEach(w => {
        w.close()
      })
      resolve()
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const options: BuildOptions = {
    watch: args.includes('--watch') || args.includes('-w'),
  }

  // Find config file
  let configPath = './build.config.ts'
  const configIndex = args.indexOf('--config')
  if (configIndex !== -1) {
    const providedConfigPath = args[configIndex + 1]
    if (!providedConfigPath) {
      console.error('❌ Missing value for --config')
      process.exit(1)
    }
    configPath = providedConfigPath
  }

  // Try to load config
  let config: BuildConfig
  const fullConfigPath = path.resolve(process.cwd(), configPath)

  try {
    // Import the config
    const module = await import(`${fullConfigPath}?t=${Date.now()}`)
    const defaultExport = module.default

    if (typeof defaultExport === 'function') {
      // Config is a function, call it with watch flag
      config = defaultExport({ watch: options.watch })
    } else {
      config = defaultExport
    }
  } catch (err) {
    console.error(`❌ Failed to load config from ${configPath}:`, err)
    process.exit(1)
  }

  const appDir = path.dirname(fullConfigPath)

  if (options.watch) {
    // Dev mode with watcher
    await buildWithBun(config, { watch: true, appDir })

    // Setup file watcher
    await setupWatcher(config, appDir, async () => {
      await buildWithBun(config, { watch: true, appDir })
    })
  } else {
    // Single build
    await buildWithBun(config, { watch: false, appDir })
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
