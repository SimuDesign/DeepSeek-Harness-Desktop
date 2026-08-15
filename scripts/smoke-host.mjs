#!/usr/bin/env node
/**
 * Boot one real `dsh web` Host through the desktop supervisor and shut it
 * down gracefully. Used to smoke-test a staged/packaged host runtime.
 *
 * Usage: node scripts/smoke-host.mjs <nodeExecutable> <cliEntry> [electronRunAsNode=0]
 * Env: DSH_HOME controls the harness home (isolate it for clean runs).
 */

import { fileURLToPath } from 'node:url'
import { createHostSupervisor, spawnDshWeb } from '../lib/host-supervisor.js'

const [, , nodeExecutable, cliEntry, electronRunAsNode] = process.argv
if (nodeExecutable === undefined || cliEntry === undefined) {
  console.error('usage: node scripts/smoke-host.mjs <nodeExecutable> <cliEntry> [electronRunAsNode=0]')
  process.exit(2)
}

const host = createHostSupervisor({
  spawnHost: () => spawnDshWeb({
    nodeExecutable,
    cliEntry,
    cwd: process.cwd(),
    env: { ...process.env },
    electronRunAsNode: electronRunAsNode === '1',
  }),
  log: chunk => process.stderr.write(chunk),
})

try {
  const url = await host.start()
  console.log(`SMOKE READY: ${url}`)
  await host.shutdown()
  console.log('SMOKE SHUTDOWN OK')
} catch (error) {
  console.error(`SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
