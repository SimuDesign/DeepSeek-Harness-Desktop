import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReadinessParser, type HostChild } from '../src/host-supervisor.ts'

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
