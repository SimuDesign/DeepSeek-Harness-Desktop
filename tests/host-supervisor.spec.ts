import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostSupervisor, createReadinessParser, type HostChild } from '../src/host-supervisor.ts'

type HostExitListener = Parameters<HostChild['onExit']>[0]
type HostExitSignal = Parameters<HostExitListener>[1]

class FakeOutput {
  private readonly listeners = new Set<(chunk: string) => void>()

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(chunk: string): void {
    for (const listener of this.listeners) listener(chunk)
  }
}

class FakeHostChild implements HostChild {
  readonly pid = 123
  readonly stdout = new FakeOutput()
  readonly stderr = new FakeOutput()
  readonly signals: Array<'SIGTERM' | 'SIGKILL'> = []
  private readonly exitListeners = new Set<HostExitListener>()
  private readonly errorListeners = new Set<(error: Error) => void>()

  onExit(listener: HostExitListener): () => void {
    this.exitListeners.add(listener)
    return () => { this.exitListeners.delete(listener) }
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => { this.errorListeners.delete(listener) }
  }

  kill(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.signals.push(signal)
  }

  emitExit(code: number | null = 0, signal: HostExitSignal = null): void {
    for (const listener of this.exitListeners) listener(code, signal)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

function observeSettlement<T>(promise: Promise<T>): ReturnType<typeof vi.fn> {
  const settled = vi.fn()
  void promise.then(settled, settled)
  return settled
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('desktop Host readiness', () => {
  it('extracts the canonical URL from arbitrarily chunked output and ignores unrelated URLs', () => {
    const parser = createReadinessParser()

    expect(parser.push('Node warning: see https://nodejs.org/docs\n')).toBeUndefined()
    expect(parser.push('dsh we')).toBeUndefined()
    expect(parser.push('b: http://127.0.')).toBeUndefined()
    expect(parser.push('0.1:4173 (LAN: http://192.0.2.10:4173)')).toBeUndefined()
    expect(parser.push('\nstartup complete\n')).toBe('http://127.0.0.1:4173')
    expect(parser.finalize()).toBe('http://127.0.0.1:4173')
  })

  it('accepts localhost as the loopback host', () => {
    const parser = createReadinessParser()
    expect(parser.push('dsh web: http://localhost:8080\n')).toBe('http://localhost:8080')
  })

  it('handles CRLF line endings', () => {
    const parser = createReadinessParser()
    expect(parser.push('dsh web: http://127.0.0.1:9000\r\n')).toBe('http://127.0.0.1:9000')
  })

  it('rejects a readiness URL that is not loopback', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://example.com:8080\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects a readiness URL without an explicit port', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://127.0.0.1\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects a non-http readiness URL', () => {
    expect(() => {
      createReadinessParser().push('dsh web: https://127.0.0.1:8080\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects a readiness URL with a path', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://127.0.0.1:8080/foo\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects a readiness URL with a query string', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://127.0.0.1:8080/?a=1\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects a readiness URL with a hash fragment', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://127.0.0.1:8080/#x\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects an out-of-range port', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://127.0.0.1:70000\n')
    }).toThrow(/readiness URL is invalid|loopback HTTP with an explicit port/)
  })

  it('rejects a zero port', () => {
    expect(() => {
      createReadinessParser().push('dsh web: http://127.0.0.1:0\n')
    }).toThrow(/loopback HTTP with an explicit port/)
  })

  it('rejects a malformed URL token', () => {
    expect(() => {
      createReadinessParser().push('dsh web: not-a-url\n')
    }).toThrow(/readiness URL is invalid/)
  })

  it('throws when conflicting readiness URLs are emitted', () => {
    const parser = createReadinessParser()
    expect(parser.push('dsh web: http://127.0.0.1:1111\n')).toBe('http://127.0.0.1:1111')
    expect(() => {
      parser.push('dsh web: http://127.0.0.1:2222\n')
    }).toThrow(/conflicting readiness URLs/)
  })

  it('returns the stable URL for further chunks after readiness', () => {
    const parser = createReadinessParser()
    expect(parser.push('dsh web: http://127.0.0.1:4173\n')).toBe('http://127.0.0.1:4173')
    expect(parser.push('more output\n')).toBe('http://127.0.0.1:4173')
  })

  it('finalize throws when no readiness line was emitted', () => {
    const parser = createReadinessParser()
    parser.push('some unrelated output\n')
    expect(() => parser.finalize()).toThrow(/exited before emitting its readiness URL/)
  })

  it('finalize returns the readiness URL once observed', () => {
    const parser = createReadinessParser()
    parser.push('dsh web: http://127.0.0.1:4173')
    expect(parser.finalize()).toBe('http://127.0.0.1:4173')
  })
})

describe('desktop Host supervisor', () => {
  it('resolves start with the readiness URL when the Host becomes ready', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      log: () => {},
    })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await expect(starting).resolves.toBe('http://127.0.0.1:4173')
  })

  it('rejects start and terminates the Host when readiness times out', async () => {
    vi.useFakeTimers()
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      readinessTimeoutMs: 90_000,
      log: () => {},
    })
    const starting = supervisor.start()
    const settled = observeSettlement(starting)
    child.stdout.emit('nothing useful\n')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(child.signals).toEqual(['SIGTERM'])
    expect(settled).toHaveBeenCalledTimes(1)
    await expect(starting).rejects.toThrow(/readiness timed out/)
  })

  it('rejects start when the Host exits before readiness, including buffered output', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      log: () => {},
    })
    const starting = supervisor.start()
    child.stderr.emit('some diagnostic line\n')
    child.emitExit(1, null)
    await expect(starting).rejects.toThrow(/exited before readiness.*some diagnostic line/s)
  })

  it('rejects start when the Host fails to spawn', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      log: () => {},
    })
    const starting = supervisor.start()
    child.emitError(new Error('spawn ENOENT'))
    await expect(starting).rejects.toThrow(/failed to spawn: spawn ENOENT/)
  })

  it('ignores a conflicting readiness line after readiness (host keeps running)', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      log: () => {},
    })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:1111\n')
    await expect(starting).resolves.toBe('http://127.0.0.1:1111')
    expect(() => child.stdout.emit('dsh web: http://127.0.0.1:2222\n')).not.toThrow()
    expect(child.signals).toEqual([])
    child.emitExit(0, 'SIGTERM')
    await supervisor.shutdown()
  })

  it('notifies onUnexpectedExit when a ready Host exits outside shutdown', async () => {
    const child = new FakeHostChild()
    const unexpected = vi.fn()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      log: () => {},
      onUnexpectedExit: unexpected,
    })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await starting
    child.emitExit(1, null)
    expect(unexpected).toHaveBeenCalledWith({ code: 1, signal: null })
  })

  it('shutdown sends SIGTERM and resolves once the Host exits', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child, log: () => {} })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await starting
    const shutting = supervisor.shutdown()
    child.emitExit(0, 'SIGTERM')
    await expect(shutting).resolves.toBeUndefined()
    expect(child.signals).toEqual(['SIGTERM'])
  })

  it('shutdown escalates to SIGKILL when the Host does not exit in time', async () => {
    vi.useFakeTimers()
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      shutdownTimeoutMs: 5_000,
      log: () => {},
    })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await starting
    const shutting = supervisor.shutdown()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    child.emitExit(0, 'SIGKILL')
    await expect(shutting).resolves.toBeUndefined()
  })

  it('coalesces concurrent start calls into one Host process', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child, log: () => {} })
    const first = supervisor.start()
    const second = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await expect(first).resolves.toBe('http://127.0.0.1:4173')
    await expect(second).resolves.toBe('http://127.0.0.1:4173')
    child.emitExit(0, 'SIGTERM')
    await supervisor.shutdown()
  })

  it('coalesces concurrent shutdown calls', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child, log: () => {} })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await starting
    const first = supervisor.shutdown()
    const second = supervisor.shutdown()
    child.emitExit(0, 'SIGTERM')
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(child.signals).toEqual(['SIGTERM'])
  })

  it('rejects start after shutdown', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child, log: () => {} })
    const starting = supervisor.start()
    child.stdout.emit('dsh web: http://127.0.0.1:4173\n')
    await starting
    const shutting = supervisor.shutdown()
    child.emitExit(0, 'SIGTERM')
    await shutting
    await expect(supervisor.start()).rejects.toThrow(/cannot start after shutdown/)
  })
})
