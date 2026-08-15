#!/usr/bin/env node
/**
 * electron-builder afterPack hook: refuse to ship an artifact whose staged
 * Host runtime is incomplete. Runs with the packed app output directory.
 *
 * Failing loudly here (throwing) aborts the packaging run before signing.
 */

import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** True when any symlink exists under `directory`. */
function hasSymlink(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) return true
    if (entry.isDirectory() && hasSymlink(path)) return true
  }
  return false
}

/** Resolve the app bundle root: afterPack may pass the bundle or its parent. */
function resolveAppBundle(appOutDir) {
  if (appOutDir.endsWith('.app')) return appOutDir
  const matches = readdirSync(appOutDir).filter((name) => name.endsWith('.app'))
  if (matches.length === 1) return join(appOutDir, matches[0])
  return appOutDir
}

/** @param context - electron-builder afterPack context. */
export default async function verifyPackagedRuntime(context) {
  const { appOutDir } = context
  const appBundle = resolveAppBundle(appOutDir)
  const hostRoot = join(appBundle, 'Contents', 'Resources', 'host', 'node_modules')
  const cliEntry = join(hostRoot, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const frontendIndex = join(hostRoot, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')

  const missing = []
  if (!existsSync(cliEntry)) missing.push(cliEntry)
  if (!existsSync(frontendIndex)) missing.push(frontendIndex)
  if (missing.length > 0) {
    throw new Error(`packaged Host runtime is incomplete; missing:\n${missing.join('\n')}\n运行 pnpm run package 前请先执行 node scripts/stage-runtime.mjs`)
  }
  if (hasSymlink(hostRoot)) {
    throw new Error('packaged Host runtime still contains symlinks; run node scripts/stage-runtime.mjs to materialize them')
  }
  console.log(`afterPack OK: host runtime staged (${cliEntry})`)
}
