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

class DevRunner {
  private process: ReturnType<typeof spawn> | null = null
  private isRunning = false

  async start(entryPath: string, appDir: string) {
    // Kill existing process if running
    if (this.process) {
      await this.kill()
    }

    this.isRunning = true
    console.log('🚀 Starting dev server...')
    const envFiles = ['../../.env', '../../.env.local']

    try {
      this.process = spawn(
        [
          'bun',
          ...envFiles.map(f => `--env-file=${path.resolve(appDir, f)}`),
          entryPath,
        ],
        {
          cwd: appDir,
          stdio: ['inherit', 'inherit', 'inherit'],
        },
      )

      // Non-blocking: don't wait for process
      this.process.exited.then(() => {
        this.isRunning = false
        console.log('🛑 Dev server stopped')
      })
    } catch (err) {
      this.isRunning = false
      console.error('❌ Failed to start dev server:', err)
    }
  }

  async kill() {
    if (this.process) {
      try {
        this.process.kill()
        // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional
        await this.process.exited.catch(() => {
          // process exit handled
        })
      } catch (err) {
        console.error('Error killing dev process:', err)
      }
      this.process = null
    }
    this.isRunning = false
  }

  isActive() {
    return this.isRunning
  }
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
): Promise<boolean> {
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

  let buildSucceed = true

  // Build for each format
  for (const format of config.format) {
    for (const entryFile of config.entry) {
      const entryPath = path.resolve(appDir, entryFile)

      // Get banner
      const bannerFn = config.banner
      const bannerText = bannerFn?.({ format })
      const suffix = format === 'cjs' ? '.cjs' : ''
      try {
        const result = await build({
          entrypoints: [entryPath],
          outdir: config.outDir,
          minify: isDev
            ? false
            : {
                whitespace: true,
                syntax: true,
                identifiers: false,
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
            entry: `[dir]/[name]${suffix}.js`,
            chunk: `[dir]/[name]-[hash]${suffix}.js`,
            asset: `[dir]/[name]-[hash]${suffix}[ext]`,
          },
        })

        if (!result.success) {
          console.error('❌ Build failed')
          for (const msg of result.logs) {
            console.error(msg)
          }
          buildSucceed = false
          if (!isDev) {
            process.exit(1)
          }
          continue // Skip to next entry in watch mode
        }

        // Add banner to output files
        if (bannerText?.js) {
          const outFile = path.resolve(
            config.outDir,
            `${path.basename(entryFile, '.ts')}${suffix}.js`,
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
        console.error('❌ Build error:', err)
        buildSucceed = false
        if (!isDev) {
          process.exit(1)
        }
      }
    }
  }

  // Copy assets in non-dev mode (relative to outDir, not appDir)
  if (!isDev && config.copy?.length) {
    try {
      await copyAssets(config.copy, appDir, config.outDir)
      console.log('✓ Assets copied')
    } catch (err) {
      console.error('❌ Error copying assets:', err)
      if (!isDev) {
        process.exit(1)
      }
      buildSucceed = false
    }
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

  if (!isDev && buildSucceed) {
    console.log('✅ Build complete!')
  } else if (isDev && buildSucceed) {
    console.log('✓ Build successful')
  }

  return buildSucceed
}

async function setupWatcher(
  _config: BuildConfig,
  appDir: string,
  onBuild: () => Promise<void>,
  onBuildSuccess: (() => Promise<void>) | undefined,
) {
  const watchDirs = [
    path.resolve(appDir, 'src'),
    path.resolve(appDir, '../../libs'),
  ]

  console.log('👀 Watching for changes...')

  const watchers: ReturnType<typeof watchFs>[] = []
  let buildInProgress = false
  let fileChanged = false

  const triggerBuild = async () => {
    if (buildInProgress) {
      fileChanged = true
      return
    }
    buildInProgress = true
    fileChanged = false

    try {
      await onBuild()
      // If build succeeded and callback provided, run it
      if (onBuildSuccess) {
        await onBuildSuccess()
      }
    } catch (err) {
      // Error already logged in onBuild, just continue watching
      console.error('Watch rebuild failed:', err)
    } finally {
      buildInProgress = false
      // If files changed while building, rebuild again
      if (fileChanged) {
        await triggerBuild()
      }
    }
  }

  for (const dir of watchDirs) {
    try {
      const watcher = watchFs(
        dir,
        { recursive: true, persistent: true },
        (_eventType, filename) => {
          if (filename?.endsWith('.ts') || filename?.endsWith('.tsx')) {
            fileChanged = true
            // debounce: trigger after small delay
            triggerBuild()
          }
        },
      )
      watchers.push(watcher)
    } catch {
      // directory might not exist
    }
  }

  // Keep process alive and gracefully handle shutdown
  return new Promise<void>(resolve => {
    const cleanup = async () => {
      console.log('\n⏹️  Stopping watcher...')
      watchers.forEach(w => {
        w.close()
      })
      resolve()
    }

    process.on('SIGINT', () => {
      cleanup()
    })

    process.on('SIGTERM', () => {
      cleanup()
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
    // Dev mode with watcher and runner
    const runner = new DevRunner()

    // Initial build
    const success = await buildWithBun(config, { watch: true, appDir })

    // After successful first build, start the dev server
    if (success && config.entry && config.entry.length > 0) {
      const entryFile = config.entry[0]
      if (entryFile) {
        const builtFile = path.resolve(
          config.outDir,
          `${path.basename(entryFile, '.ts')}.js`,
        )
        await runner.start(builtFile, appDir)
      }
    }

    // Setup file watcher with dev server restart on successful rebuild
    await setupWatcher(
      config,
      appDir,
      async () => {
        // Build on file change
        await buildWithBun(config, { watch: true, appDir })
      },
      async () => {
        // After successful build, restart dev server
        if (config.entry && config.entry.length > 0) {
          const entryFile = config.entry[0]
          if (entryFile) {
            const builtFile = path.resolve(
              config.outDir,
              `${path.basename(entryFile, '.ts')}.js`,
            )
            await runner.start(builtFile, appDir)
          }
        }
      },
    )

    // Cleanup on exit
    process.on('exit', async () => {
      await runner.kill()
    })
  } else {
    // Single build
    const success = await buildWithBun(config, { watch: false, appDir })
    if (!success) {
      process.exit(1)
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
