/** Resolve the desktop Host artifacts in development and packaged layouts. */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Electron app surface consumed by host path resolution. */
export interface DesktopAppFacade {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  getPath(name: 'home'): string
}

/** Node runtime, built CLI and working directory for the desktop Host. */
export interface HostPaths {
  readonly nodeExecutable: string
  readonly cliEntry: string
  readonly cwd: string
  readonly electronRunAsNode: boolean
}

/**
 * Resolve the Host artifacts for the current layout.
 * @param app - Electron app facade (mocked in tests).
 * @param env - Launch environment; `DSH_DESKTOP_NODE_EXECUTABLE` overrides the dev-mode Node.
 * @param moduleUrl - This module's URL, used to locate the repository root.
 * @returns The child-process Host configuration.
 */
export function resolveHostPaths(
  app: DesktopAppFacade,
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): HostPaths {
  if (!app.isPackaged) {
    const repositoryRoot = join(dirname(fileURLToPath(moduleUrl)), '..')
    return {
      nodeExecutable: env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node',
      cliEntry: join(repositoryRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      cwd: process.cwd(),
      electronRunAsNode: false,
    }
  }
  return {
    nodeExecutable: process.execPath,
    cliEntry: join(app.resourcesPath, 'host', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    cwd: app.getPath('home'),
    electronRunAsNode: true,
  }
}

/** Fail loudly when the Host artifacts the app will spawn are missing. */
export function assertHostArtifacts(paths: HostPaths): void {
  if (paths.nodeExecutable.includes('/') && !existsSync(paths.nodeExecutable)) {
    throw new Error(`desktop Node runtime is missing: ${paths.nodeExecutable}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`desktop Host entry is missing: ${paths.cliEntry}; run pnpm run build first`)
  }
}
