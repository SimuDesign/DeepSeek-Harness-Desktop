#!/usr/bin/env node
/**
 * Generate the desktop resources from the official DeepSeek favicon:
 *   - icon.png           512x512 app icon: brand-blue rounded square + white whale
 *   - trayTemplate.png   16x16 macOS tray template (black whale)
 *   - trayTemplate@2x.png 32x32 macOS tray template (black whale)
 *
 * The whale path comes from the official repo's apps/web/public/favicon.svg
 * (deepseek-ai/deepseek-harness, MIT). Rendered with sharp (libvips).
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const favicon = readFileSync(join(resourcesDir, 'deepseek-favicon.svg'), 'utf8')

/** Extract the whale path `d` from the official favicon SVG. */
function whalePath(svg) {
  const match = svg.match(/<path[^>]*\bd="([^"]+)"/)
  if (match === null) throw new Error('no <path d> found in favicon.svg')
  return match[1]
}

const WHALE_D = whalePath(favicon)
const BRAND_BLUE = '#4D6BFE'

/** App icon: brand-blue rounded square with the white whale centered. */
function appIconSvg(size) {
  const padding = Math.round(size * 0.10)
  const radius = Math.round(size * 0.225)
  const whaleScale = size / 50 * 0.62
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${padding}" y="${padding}" width="${size - padding * 2}" height="${size - padding * 2}" rx="${radius}" fill="${BRAND_BLUE}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${whaleScale}) translate(-25 -25)">
    <path d="${WHALE_D}" fill="#ffffff"/>
  </g>
</svg>`
}

/** Tray template icon: black whale on transparency (macOS recolors it). */
function trayIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 50 50">
  <path d="${WHALE_D}" fill="#000000"/>
</svg>`
}

async function renderSvg(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer()
}

mkdirSync(resourcesDir, { recursive: true })
writeFileSync(join(resourcesDir, 'icon.png'), await renderSvg(appIconSvg(512)))
writeFileSync(join(resourcesDir, 'trayTemplate.png'), await renderSvg(trayIconSvg(16)))
writeFileSync(join(resourcesDir, 'trayTemplate@2x.png'), await renderSvg(trayIconSvg(32)))
console.log(`resources written to ${resourcesDir}`)
