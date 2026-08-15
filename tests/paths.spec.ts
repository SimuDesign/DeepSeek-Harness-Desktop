import { describe, expect, it } from 'vitest'
import { resolveHostPaths, assertHostArtifacts, type DesktopAppFacade } from '../src/paths.ts'

function fakeApp(packaged: boolean, resourcesPath = '/app/Contents/Resources'): DesktopAppFacade {
  return {
    isPackaged: packaged,
    resourcesPath,
    getPath: (name) => name === 'home' ? '/Users/fake/home' : '',
  }
}

describe('desktop host path resolution', () => {
  it('resolves the checkout dsh CLI in development mode', () => {
    const paths = resolveHostPaths(fakeApp(false), {}, 'file:///repo/src/paths.ts')
    expect(paths.nodeExecutable).toBe('node')
    expect(paths.cliEntry).toBe('/repo/node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(paths.electronRunAsNode).toBe(false)
    expect(paths.cwd).toBe(process.cwd())
  })

  it('honors DSH_DESKTOP_NODE_EXECUTABLE in development mode', () => {
    const paths = resolveHostPaths(fakeApp(false), { DSH_DESKTOP_NODE_EXECUTABLE: '/opt/node/bin/node' }, 'file:///repo/src/paths.ts')
    expect(paths.nodeExecutable).toBe('/opt/node/bin/node')
  })

  it('resolves the bundled host CLI from resources in packaged mode', () => {
    const paths = resolveHostPaths(fakeApp(true), {}, 'file:///repo/src/paths.ts')
    expect(paths.nodeExecutable).toBe(process.execPath)
    expect(paths.cliEntry).toBe('/app/Contents/Resources/host/node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(paths.electronRunAsNode).toBe(true)
    expect(paths.cwd).toBe('/Users/fake/home')
  })

  it('asserts host artifacts exist before boot', () => {
    expect(() => assertHostArtifacts({
      nodeExecutable: 'node',
      cliEntry: '/definitely/missing/bin.js',
      cwd: process.cwd(),
      electronRunAsNode: false,
    })).toThrow(/Host entry is missing/)
  })

  it('asserts a path-shaped node executable exists', () => {
    expect(() => assertHostArtifacts({
      nodeExecutable: '/definitely/missing/node',
      cliEntry: '/definitely/missing/bin.js',
      cwd: process.cwd(),
      electronRunAsNode: false,
    })).toThrow(/Node runtime is missing/)
  })

  it('accepts a complete artifact set', () => {
    expect(() => assertHostArtifacts({
      nodeExecutable: 'node',
      cliEntry: '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      cwd: process.cwd(),
      electronRunAsNode: false,
    })).not.toThrow()
  })
})
