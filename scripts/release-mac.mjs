#!/usr/bin/env node
/**
 * Signed, notarized macOS release path.
 *
 * Preflights the environment (macOS host, Developer ID Application identity,
 * complete notarization credentials), then builds the signed+notarized DMG
 * through electron-builder and verifies signature, Gatekeeper and stapling.
 *
 * Notarization credentials (electron-builder reads these from the env):
 *   - Keychain profile:  xcrun notarytool store-credentials "dsh-notary" \
 *       --apple-id "<Apple ID>" --team-id "<Team ID>"
 *     then run with APPLE_KEYCHAIN_PROFILE=dsh-notary
 *   - Apple ID group: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 *   - App Store Connect API key group: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER
 *
 * Signing identity: MACOS_SIGN_IDENTITY (defaults to the first Developer ID
 * Application identity in the login keychain), or a PKCS#12 at
 * MAC_CERT_P12_BASE64 + CSC_KEY_PASSWORD (electron-builder imports it).
 *
 * Unsigned local builds need none of this: `pnpm run package` produces an
 * unpacked .app; `pnpm run dist` produces an unsigned DMG. On first open,
 * right-click -> Open, or: xattr -d com.apple.quarantine "DeepSeek Harness.app"
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`release preflight failed: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
    cwd: options.cwd ?? repoRoot,
  })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited ${String(result.status)}`)
  }
}

function resolveElectronBuilder() {
  const candidates = [
    join(repoRoot, 'node_modules', '.bin', 'electron-builder'),
    join(repoRoot, '.tools', 'npm-global', 'bin', 'electron-builder'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) fail('electron-builder is not installed; run pnpm install first')
  return found
}

function identityCandidates() {
  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    return output.split('\n')
      .map((line) => line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"\s*$/))
      .filter((match) => match !== null && match[2].includes('Developer ID Application'))
      .map((match) => ({ hash: match[1], name: match[2] }))
  } catch {
    return []
  }
}

function preflight() {
  if (process.platform !== 'darwin') {
    fail('macOS signing/notarization must run on macOS')
  }
  const candidates = identityCandidates()
  if (candidates.length === 0 && !process.env.MAC_CERT_P12_BASE64) {
    fail('no Developer ID Application identity found in the login keychain and no MAC_CERT_P12_BASE64 provided')
  }
  const notary = process.env.APPLE_KEYCHAIN_PROFILE
    || (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
    || (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER)
  if (!notary) {
    fail('notarization credentials missing; use APPLE_KEYCHAIN_PROFILE, the APPLE_ID group, or the APPLE_API_KEY group')
  }
  return candidates[0]?.name
}

function findDmg() {
  const distDir = join(repoRoot, 'dist')
  const candidates = readdirSync(distDir).filter((name) => name.endsWith('.dmg'))
  if (candidates.length === 0) fail('no DMG produced under dist/')
  return join(distDir, candidates[0])
}

function main() {
  const identity = preflight()

  run(process.execPath, ['scripts/stage-runtime.mjs'])
  const builder = resolveElectronBuilder()
  const args = ['--mac', 'dmg']
  if (identity !== undefined) {
    args.push('--config.mac.identity', identity)
  }
  run(builder, args)

  const dmg = findDmg()
  const mountPoint = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim()
  try {
    run('hdiutil', ['attach', dmg, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    const appPath = join(mountPoint, 'DeepSeek Harness.app')
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
    run('xcrun', ['stapler', 'validate', appPath])
    console.log('release verification OK:', appPath)
  } finally {
    run('hdiutil', ['detach', mountPoint], { cwd: repoRoot })
  }
}

main()
