#!/usr/bin/env bun

import { file, write } from 'bun'
import path from 'path'

async function genPkg(appName: string) {
  const appPkg = await file(path.resolve(process.cwd(), 'package.json')).json()

  const finalPkg = {
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

  await write(
    path.resolve(process.cwd(), '../../', 'dist', appName, 'package.json'),
    JSON.stringify(finalPkg, null, 2),
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: gen-pkg <app-name1> <app-name2>...')
    process.exit(1)
  }

  for (const appName of args) {
    await genPkg(appName)
  }
}

main()
