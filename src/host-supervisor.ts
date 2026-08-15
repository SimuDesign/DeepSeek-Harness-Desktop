/** Supervise the loopback Web Host used by the desktop application. */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

const READINESS_PREFIX = 'dsh web: '
const DEFAULT_READINESS_TIMEOUT_MS = 90_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const MAX_STARTUP_OUTPUT_CHARS = 32_768

/** Incremental parser for the Web Host's canonical readiness line. */
export interface ReadinessParser {
  /**
   * Consume one stdout chunk.
   * @param chunk - Text emitted by the Host.
   * @returns The loopback URL once a complete readiness line is observed.
   */
  push(chunk: string): string | undefined
  /**
   * Finish the stream and require a readiness line.
   * @returns The parsed loopback URL.
   */
  finalize(): string
}

/** Assert and normalize one readiness line. */
function parseReadinessLine(line: string): string | undefined {
  if (!line.startsWith(READINESS_PREFIX)) return undefined
  const token = line.slice(READINESS_PREFIX.length).split(/\s/u, 1)[0]
  if (token === undefined) throw new Error(`desktop Host readiness line has no URL: ${line}`)

  let url: URL
  try {
    url = new URL(token)
  } catch {
    throw new Error(`desktop Host readiness URL is invalid: ${token}`)
  }
  const port = Number(url.port)
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    throw new Error(`desktop Host readiness URL must be loopback HTTP with an explicit port: ${token}`)
  }
  return url.origin
}

/**
 * Create a line parser whose result is stable after readiness.
 * @returns A fresh incremental parser.
 */
export function createReadinessParser(): ReadinessParser {
  let pending = ''
  let readyUrl: string | undefined

  const accept = (line: string): string | undefined => {
    const parsed = parseReadinessLine(line.replace(/\r$/u, ''))
    if (parsed === undefined) return undefined
    if (readyUrl !== undefined && parsed !== readyUrl) {
      throw new Error(`desktop Host emitted conflicting readiness URLs: ${readyUrl} and ${parsed}`)
    }
    readyUrl = parsed
    return readyUrl
  }

  return {
    push(chunk) {
      pending += chunk
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline === -1) return readyUrl
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        const parsed = accept(line)
        if (parsed !== undefined) return parsed
      }
    },
    finalize() {
      if (pending !== '') accept(pending)
      if (readyUrl === undefined) throw new Error('desktop Host exited before emitting its readiness URL')
      return readyUrl
    },
  }
}

/** Child process operations the supervisor owns. */
export interface HostChild {
  readonly pid?: number
  readonly stdout: { onData(listener: (chunk: string) => void): () => void }
  readonly stderr: { onData(listener: (chunk: string) => void): () => void }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void
  onError(listener: (error: Error) => void): () => void
  kill(signal: 'SIGTERM' | 'SIGKILL'): void
}
