import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

describe('packaging configuration', () => {
  it('defines the desktop app identity', () => {
    expect(manifest.build.appId).toBe('com.dsh.desktop')
    expect(manifest.build.productName).toBe('DeepSeek Harness')
    expect(manifest.main).toBe('lib/main.js')
  })

  it('packs the app under asar with only the built main process', () => {
    expect(manifest.build.asar).toBe(true)
    expect(manifest.build.files).toEqual(['lib/**', 'package.json'])
  })

  it('stages the host runtime and tray resources as extra resources', () => {
    const froms = manifest.build.extraResources.map((entry) => entry.from)
    expect(froms).toContain('runtime-host/node_modules')
    const host = manifest.build.extraResources.find((entry) => entry.to === 'host/node_modules')
    expect(host).toBeDefined()
    expect(host.from).toBe('runtime-host/node_modules')
    expect(manifest.build.extraResources.some((entry) => entry.to === 'desktop-resources')).toBe(true)
  })

  it('reuses the checkout electron dist instead of downloading another binary', () => {
    expect(manifest.build.electronDist).toBe('node_modules/electron/dist')
  })

  it('refuses incomplete artifacts via the afterPack hook', () => {
    const hook = manifest.build.afterPack
    expect(typeof hook).toBe('string')
    expect(existsSync(join(repoRoot, hook))).toBe(true)
  })

  it('targets the developer-tools category on macOS with hardened runtime', () => {
    expect(manifest.build.mac.category).toBe('public.app-category.developer-tools')
    expect(manifest.build.mac.hardenedRuntime).toBe(true)
    const arches = manifest.build.mac.target.flatMap((target) => target.arch)
    expect(arches).toContain('arm64')
    expect(arches).toContain('x64')
  })

  it('keeps the dsh version pinned exactly in the staged runtime', () => {
    const runtime = JSON.parse(readFileSync(join(repoRoot, 'runtime', 'package.json'), 'utf8'))
    expect(runtime.dependencies['@deepseek-ai/dsh']).toBe('0.1.0-rc.6')
  })
})
