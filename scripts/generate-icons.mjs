#!/usr/bin/env node
/**
 * Generate the desktop resources: app icon and macOS tray template icons.
 * Pure Node PNG encoder (RGBA, no external deps).
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

/** Encode RGBA pixels (rows x cols) into a PNG buffer. */
function encodePng(width, height, pixelAt) {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y)
      const offset = rowStart + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** macOS template icon: black glyph, transparent background. */
function templateIcon(size, radius) {
  const center = (size - 1) / 2
  return encodePng(size, size, (x, y) => {
    const dx = x - center
    const dy = y - center
    const distance = Math.sqrt(dx * dx + dy * dy)
    const ring = Math.max(0, Math.min(1, (distance - radius * 0.72) / (radius * 0.10)))
    const alpha = ring <= 0 ? 255 : ring >= 1 ? 0 : Math.round((1 - ring) * 255)
    return [0, 0, 0, alpha]
  })
}

/** App icon: rounded-square gradient-ish (two-tone) with a white ring. */
function appIcon(size) {
  const center = (size - 1) / 2
  const corner = size * 0.22
  return encodePng(size, size, (x, y) => {
    const inside = roundedRect(x + 0.5, y + 0.5, size, corner)
    if (!inside) return [0, 0, 0, 0]
    const dx = x - center
    const dy = y - center
    const distance = Math.sqrt(dx * dx + dy * dy)
    const ring = Math.abs(distance - size * 0.24) < size * 0.045
    if (ring) return [255, 255, 255, 255]
    const t = (x + y) / (2 * size)
    const r = Math.round(24 + t * 40)
    const g = Math.round(92 + t * 60)
    const b = Math.round(140 + t * 70)
    return [r, g, b, 255]
  })
}

function roundedRect(x, y, size, corner) {
  const half = size / 2
  const cx = Math.abs(x - half)
  const cy = Math.abs(y - half)
  const dx = Math.max(cx - half + corner, 0)
  const dy = Math.max(cy - half + corner, 0)
  return dx * dx + dy * dy <= corner * corner
}

mkdirSync(resourcesDir, { recursive: true })
writeFileSync(join(resourcesDir, 'icon.png'), appIcon(512))
writeFileSync(join(resourcesDir, 'trayTemplate.png'), templateIcon(16, 16 / 2))
writeFileSync(join(resourcesDir, 'trayTemplate@2x.png'), templateIcon(32, 32 / 2))
console.log(`resources written to ${resourcesDir}`)
