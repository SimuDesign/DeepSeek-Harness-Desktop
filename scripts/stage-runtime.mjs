#!/usr/bin/env node
/**
 * Materialize the packaged desktop Host dependency closure.
 *
 * Installs `runtime/package.json` (the exact `@deepseek-ai/dsh` pin) into
 * `runtime-host/`, then replaces every pnpm symlink under `node_modules` with
 * a real copy so the staged tree survives asar/extraResources packaging and
 * works without a package manager. Fails loudly when the CLI entry or the
 * web frontend dist is missing.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = join(repoRoot, 'runtime')
const staging = join(repoRoot, 'runtime-host')
const nodeModules = join(staging, 'node_modules')
const cliEntry = join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** Locate a pnpm binary: explicit env, workspace-local toolchain, then PATH. */
function resolvePnpm() {
  const explicit = process.env.DSH_DESKTOP_PNPM
  if (explicit !== undefined) return explicit
  const workspaceLocal = join(repoRoot, '.tools', 'npm-global', 'bin', 'pnpm')
  if (existsSync(workspaceLocal)) return workspaceLocal
  return 'pnpm'
}

async function run(command, args, cwd) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: 'true' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) accept()
      else reject(new Error(`runtime staging failed (${code === null ? `signal ${String(signal)}` : `exit ${String(code)}`}): ${command} ${args.join(' ')}`))
    })
  })
}

async function collectSymlinks(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      out.push(path)
    } else if (metadata.isDirectory()) {
      await collectSymlinks(path, out)
    }
  }
  return out
}

/**
 * Replace every pnpm symlink with a real copy; drop `.bin` shims.
 *
 * One pass collects all symlinks and materializes each with dereference so
 * the copies never reintroduce symlinks; repeat until a pass finds none.
 */
async function materializeLinks() {
  for (let pass = 0; ; pass += 1) {
    const links = await collectSymlinks(nodeModules)
    if (links.length === 0) return
    if (pass >= 100) throw new Error(`runtime staging did not converge after ${String(pass)} materialization passes`)
    for (const link of links) {
      const segments = link.slice(nodeModules.length + 1).split(sep)
      const bin = segments.lastIndexOf('.bin')
      if (bin >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, bin + 1)), { recursive: true, force: true })
        continue
      }
      const source = await realpath(link)
      await rm(link, { recursive: true, force: true })
      await cp(source, link, {
        recursive: true,
        dereference: true,
        filter: path => path !== join(source, 'node_modules') && !path.startsWith(join(source, 'node_modules') + sep),
      })
    }
  }
}

async function stage() {
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  // Install into the staging dir itself so its node_modules lands inside
  // runtime-host/ before symlinks are materialized.
  await copyFile(join(runtimeDir, 'package.json'), join(staging, 'package.json'))
  const pnpm = resolvePnpm()
  // node-linker=hoisted flattens every transitive dependency into the
  // top-level node_modules, so bare imports keep resolving after the pnpm
  // symlinks are materialized into real files.
  await run(pnpm, ['install', '--prod', '--ignore-scripts', '--config.node-linker=hoisted', '--store-dir', join(repoRoot, '.caches', 'pnpm-store')], staging)
  await materializeLinks()

  // With node-linker=hoisted the whole closure sits at the top level, so the
  // CLI entry and the web frontend dist must exist there.
  const frontendIndex = join(nodeModules, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
  const missing = []
  if (!existsSync(cliEntry)) missing.push(cliEntry)
  if (!existsSync(frontendIndex)) missing.push(frontendIndex)
  if (missing.length > 0) {
    throw new Error(`runtime staging produced an incomplete closure; missing:\n${missing.join('\n')}`)
  }
  console.log(`runtime staged: ${cliEntry}`)
}

stage().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
