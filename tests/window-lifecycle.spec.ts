import { describe, expect, it, vi } from 'vitest'
import { createDesktopLifecycle, type DesktopWindow, type WindowCloseEvent } from '../src/window-lifecycle.ts'

class FakeWindow implements DesktopWindow {
  destroyed = false
  visible = false
  readonly events: string[] = []

  isDestroyed(): boolean { return this.destroyed }
  isVisible(): boolean { return this.visible }
  show(): void { this.visible = true; this.events.push('show') }
  focus(): void { this.events.push('focus') }
  hide(): void { this.visible = false; this.events.push('hide') }
}

function closeEvent(): WindowCloseEvent & { prevented: boolean } {
  let prevented = false
  return {
    get prevented() { return prevented },
    preventDefault() { prevented = true },
  }
}

function harness(overrides: Partial<Parameters<typeof createDesktopLifecycle>[0]> = {}) {
  const window = new FakeWindow()
  const createWindow = vi.fn(async () => window)
  const disposeHost = vi.fn(async () => {})
  const quit = vi.fn()
  const reportError = vi.fn()
  const lifecycle = createDesktopLifecycle({
    getWindow: () => window,
    createWindow,
    disposeHost,
    quit,
    reportError,
    ...overrides,
  })
  return { window, createWindow, disposeHost, quit, reportError, lifecycle }
}

describe('desktop window lifecycle', () => {
  it('hides the window on an ordinary close', () => {
    const { window, lifecycle } = harness()
    const event = closeEvent()
    lifecycle.onWindowClose(event)
    expect(event.prevented).toBe(true)
    expect(window.events).toContain('hide')
  })

  it('lets the close proceed once quitting has begun', async () => {
    const { window, lifecycle } = harness()
    const closing = lifecycle.requestQuit()
    const event = closeEvent()
    lifecycle.onWindowClose(event)
    expect(event.prevented).toBe(false)
    expect(window.events).not.toContain('hide')
    await closing
  })

  it('reveals and focuses an existing hidden window', async () => {
    const { window, createWindow, lifecycle } = harness()
    window.visible = false
    await lifecycle.showWindow()
    expect(createWindow).not.toHaveBeenCalled()
    expect(window.visible).toBe(true)
    expect(window.events).toContain('focus')
  })

  it('creates a replacement window when the current one is destroyed', async () => {
    const { window, createWindow, lifecycle } = harness()
    window.destroyed = true
    await lifecycle.showWindow()
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.visible).toBe(true)
  })

  it('coalesces concurrent showWindow calls into one window creation', async () => {
    const { window, createWindow, lifecycle } = harness()
    window.destroyed = true
    const first = lifecycle.showWindow()
    const second = lifecycle.showWindow()
    await Promise.all([first, second])
    expect(createWindow).toHaveBeenCalledTimes(1)
  })

  it('disposes the Host exactly once before releasing the quit', async () => {
    const { disposeHost, quit, lifecycle } = harness()
    const first = lifecycle.requestQuit()
    const second = lifecycle.requestQuit()
    await Promise.all([first, second])
    expect(disposeHost).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(lifecycle.isQuitting).toBe(true)
    expect(lifecycle.pendingQuit).toBe(first)
  })

  it('reports a Host disposal failure but still quits', async () => {
    const failingDispose = vi.fn(async () => { throw new Error('host stuck') })
    const { quit, reportError, lifecycle } = harness({ disposeHost: failingDispose })
    await lifecycle.requestQuit()
    expect(reportError).toHaveBeenCalledWith(expect.any(Error))
    expect(quit).toHaveBeenCalledTimes(1)
    expect(failingDispose).toHaveBeenCalledTimes(1)
  })

  it('does not show the window after quitting has begun', async () => {
    const { window, lifecycle } = harness()
    void lifecycle.requestQuit()
    await lifecycle.showWindow()
    expect(window.events).not.toContain('show')
  })
})
