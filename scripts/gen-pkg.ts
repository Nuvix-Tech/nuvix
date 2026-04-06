#!/usr/bin/env bun

import { file, write } from 'bun'
import path from 'path'

async function genPkg(appName: string, deps: Record<string, string> = {}) {
  const appPkg = await file(path.resolve(process.cwd(), 'package.json')).json()

  const finalPkg: any = {
    name: appPkg.name,
    version: appPkg.version,
    private: false,
    type: appPkg.type,
    main: appPkg.main,
    module: appPkg.module,
    scripts: {
      start: 'bun build/main.js',
    },
  }

  if (Object.keys(deps).length > 0) {
    finalPkg.dependencies = deps
  }

  await write(
    path.resolve(process.cwd(), '../../', 'dist', appName, 'package.json'),
    JSON.stringify(finalPkg, null, 2),
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error(
      'Usage: gen-pkg <app-name1> <app-name2>... [--deps pkg@version ...]',
    )
    process.exit(1)
  }

  const depsIndex = args.indexOf('--deps')
  const appNames = depsIndex === -1 ? args : args.slice(0, depsIndex)
  const deps: Record<string, string> = {}

  if (depsIndex !== -1) {
    const depArgs = args.slice(depsIndex + 1)
    for (const dep of depArgs) {
      const lastAtIndex = dep.lastIndexOf('@')
      if (lastAtIndex > 0) {
        const name = dep.substring(0, lastAtIndex)
        const version = dep.substring(lastAtIndex + 1)
        if (name && version) {
          deps[name] = version
        }
      }
    }
  }

  for (const appName of appNames) {
    await genPkg(appName, deps)
  }
}

main()
