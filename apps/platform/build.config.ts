import { defineConfig } from '../../scripts/bun-build-config'

export default defineConfig(options => {
  const isDev = options.watch

  return {
    entry: ['src/main.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: isDev,
    clean: !isDev,
    outDir: isDev ? 'dist' : '../../dist/platform/build',
    noExternal: ['@nuvix/core', '@nuvix/utils', '@nuvix/pg-meta'],
    splitting: false,
    minify: !isDev,
    target: 'es2024',
    skipNodeModulesBundle: true,
    external: [
      '@nestjs/platform-express',
      'class-transformer/storage',
      '@nestjs/microservices',
    ],
    bundle: true,
    shims: false,
    tsconfig: './tsconfig.app.json',
    onSuccess: !isDev ? undefined : 'bun --watch dist/main.js',
    copy: !isDev
      ? [
          {
            from: ['../../assets/*'],
            to: ['../assets'],
          },
          {
            from: ['../../docs/references/*'],
            to: ['../docs/references'],
          },
          {
            from: ['../../public/*'],
            to: ['../public'],
          },
          {
            from: ['../../LICENSE', '../../.env.example'],
            to: ['../'],
          },
          {
            from: ['../../README.md'],
            to: ['../README.md'],
          },
        ]
      : undefined,
  }
})
