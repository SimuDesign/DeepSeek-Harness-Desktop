/** Electron application shell for the loopback DeepSeek Harness Web Host. */

import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type Event,
  type MenuItemConstructorOptions,
} from 'electron'
import { createHostSupervisor, spawnDshWeb, type HostSupervisor } from './host-supervisor.ts'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle.ts'
import { assertHostArtifacts, resolveHostPaths, type HostPaths } from './paths.ts'

const APP_NAME = 'DeepSeek Harness'
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 920
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Make the conversation header drag the frameless window.
 *
 * The official web UI knows nothing about a desktop frame, so the shell
 * injects `-webkit-app-region` rules keyed on the stable slot contract
 * (`data-slot="conversation.session.header"`, rendered by dsh-client-web-react)
 * plus the hero workspace row. Interactive controls inside the header are
 * restored to `no-drag` so clicks keep working.
 *
 * The slot element itself renders `display: contents` (no box of its own),
 * so the drag rule must target its descendants — otherwise the region has
 * zero hit area and the header cannot be dragged at all.
 */
const DRAG_REGION_CSS = `
  [data-slot="conversation.session.header"],
  [data-slot="conversation.session.header"] * {
    -webkit-app-region: drag;
  }
  [data-slot="conversation.session.header"] button,
  [data-slot="conversation.session.header"] a,
  [data-slot="conversation.session.header"] input,
  [data-slot="conversation.session.header"] select,
  [data-slot="conversation.session.header"] textarea,
  [data-slot="conversation.session.header"] [role="button"],
  [data-slot="conversation.session.header"] [tabindex] {
    -webkit-app-region: no-drag;
  }
  [data-phase="hero"] [class*="heroWorkspaceRow"] {
    -webkit-app-region: drag;
  }
  [data-phase="hero"] [class*="heroWorkspaceRow"] * {
    -webkit-app-region: no-drag;
  }
  /* Sidebar: the slot element renders display:contents (boxless). Drag only
     the column's own box — its padding, i.e. the traffic-light clearance and
     the column edges. EVERY descendant gets an explicit no-drag: app-region
     propagates down the DOM (a drag region swallows clicks on its subtree
     unless interrupted by no-drag — "none" computed style is NOT enough), so
     the blanket rule is what keeps rows, list scrolling and the settings
     panel (which renders inside this slot) clickable. */
  [data-slot="sidebar"] > * {
    -webkit-app-region: drag;
  }
  /* Every descendant of the column gets an explicit no-drag (NOT "*" — that
     would also match the column itself and kill the drag region). */
  [data-slot="sidebar"] > * * {
    -webkit-app-region: no-drag;
  }
`

/**
 * macOS-only clearance so the sidebar wordmark row does not collide with the
 * traffic lights (roughly x 16..70 / y 18..34 with hiddenInset). The sidebar
 * column is border-box, so padding-top compresses the flex:1 list region
 * instead of overflowing the window.
 */
const MACOS_SIDEBAR_CLEARANCE_CSS = `
  [data-slot="sidebar"] > * {
    box-sizing: border-box !important;
    padding-top: 48px !important;
  }
`

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let host: HostSupervisor | undefined
let lifecycle: DesktopLifecycle | undefined
let hostOrigin: string | undefined
let bootQuitPromise: Promise<void> | undefined
let quitReleased = false
let hostLogStream: WriteStream | undefined

/** Mirror Host output to stderr and a persistent diagnostics file. */
function createHostLogger(): (chunk: string) => void {
  const logDir = app.isPackaged
    ? join(app.getPath('logs'), 'dsh-desktop')
    : join(DESKTOP_DIR, '.logs')
  mkdirSync(logDir, { recursive: true })
  hostLogStream = createWriteStream(join(logDir, 'host.log'), { flags: 'a' })
  return (chunk) => {
    process.stderr.write(chunk)
    hostLogStream?.write(chunk)
  }
}

/** Resolve artifacts from the checkout in development and resourcesPath when packaged. */
function hostPaths(): HostPaths {
  return resolveHostPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    getPath: (name) => app.getPath(name),
  })
}

function assertHostArtifactsPresent(paths: HostPaths): void {
  try {
    assertHostArtifacts(paths)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n如需开发模式，请先运行 pnpm install；如需打包模式，请先运行 pnpm run package。`)
  }
}

/** Load the app-local tray template, with an empty fallback for incomplete staging. */
function trayImage(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-resources/trayTemplate.png')]
    : [join(DESKTOP_DIR, 'resources/trayTemplate.png')]
  const path = candidates.find(candidate => existsSync(candidate))
  const image = path === undefined ? nativeImage.createEmpty() : nativeImage.createFromPath(path)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

/** Resolve the sandboxed preload in development and resourcesPath when packaged. */
function preloadPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-resources/preload.cjs')]
    : [join(DESKTOP_DIR, 'resources/preload.cjs')]
  return candidates.find(candidate => existsSync(candidate))
}

function isExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function hasOrigin(raw: string, expected: string): boolean {
  try {
    return new URL(raw).origin === expected
  } catch {
    return false
  }
}

/** Install navigation and permission policy before the first renderer loads. */
function hardenSession(): void {
  const desktopSession = session.defaultSession
  // Clipboard WRITE stays enabled: the harness web UI copies through
  // navigator.clipboard.writeText(), which rejects when the
  // clipboard-sanitized-write permission check is denied. Clipboard READ is
  // deliberately NOT allowlisted — the shipped UI never calls
  // navigator.clipboard.readText (paste rides the DOM `paste` event, which
  // needs no permission), so granting it would only let any renderer script
  // silently read the user's clipboard. Every other permission — media,
  // geolocation, sensors, … — remains denied.
  const allowedPermissions = new Set(['clipboard-sanitized-write'])
  desktopSession.setPermissionCheckHandler((_wc, permission) => allowedPermissions.has(permission))
  desktopSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission))
  })
}

async function createMainWindow(): Promise<BrowserWindow> {
  const origin = hostOrigin
  if (origin === undefined) throw new Error('desktop Host is not ready')
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    frame: process.platform === 'win32',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : {
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: 44,
      },
    }),
    ...(process.platform === 'darwin' ? {
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'followWindow' as const,
    } : {}),
    ...(process.platform === 'win32' ? {
      backgroundMaterial: 'acrylic' as const,
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    } : {
      transparent: true,
      backgroundColor: '#00000000',
    }),
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath(),
    },
  })
  mainWindow = window
  window.on('close', (event) => { lifecycle?.onWindowClose(event) })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (hasOrigin(url, origin)) return
    event.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const rendererUrl = new URL(origin)
  rendererUrl.searchParams.set('dsh-desktop-platform', process.platform)
  await window.loadURL(rendererUrl.href)
  // Declarative rules apply to elements rendered later, so inserting once
  // after load is enough; the header slot appears once the client boots.
  await window.webContents.insertCSS(
    DRAG_REGION_CSS + (process.platform === 'darwin' ? MACOS_SIDEBAR_CLEARANCE_CSS : '')
  )
  void verifyDragRegions(window)
  if (!lifecycle?.isQuitting) window.show()
  return window
}

/**
 * Poll the renderer for the injected drag regions and log the outcome, so a
 * future harness update that renames the header slot is caught at startup.
 */
async function verifyDragRegions(window: BrowserWindow): Promise<void> {
  const probe = `(() => {
    const regionOf = (el) => el === null ? 'missing' : getComputedStyle(el).webkitAppRegion
    const boxedDrag = (root) => [...root.querySelectorAll('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        // Slots render display:contents (boxless), so only count descendants
        // that carry a real box — boxes === 0 means zero draggable area even
        // when the computed style says drag.
        return r.width > 0 && r.height > 0 && getComputedStyle(el).webkitAppRegion === 'drag'
      })
      .length
    const controls = (root) => [...root.querySelectorAll('button, a, [role="button"], [tabindex]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      .map((el) => getComputedStyle(el).webkitAppRegion)
    const header = document.querySelector('[data-slot="conversation.session.header"]')
    const sidebar = document.querySelector('[data-slot="sidebar"]')
    if (header === null || sidebar === null) return 'slots not rendered yet'
    const hidden = getComputedStyle(header).display === 'none' || getComputedStyle(header).visibility === 'hidden'
    return 'header=' + regionOf(header) + ' hidden=' + String(hidden) + ' boxes=' + String(boxedDrag(header)) +
      ' headerControls=' + [...new Set(controls(header))].join(',') +
      ' sidebar=' + regionOf(sidebar) + ' boxes=' + String(boxedDrag(sidebar)) +
      ' sidebarControls=' + [...new Set(controls(sidebar))].join(',')
  })()`
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const report = await window.webContents.executeJavaScript(probe)
      if (typeof report === 'string' && !report.includes('not rendered yet')) {
        console.log(`desktop drag regions: ${report}`)
        return
      }
    } catch {
      // Renderer not ready yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  console.warn('desktop drag regions: conversation header slot never appeared')
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip(APP_NAME)
  const template: MenuItemConstructorOptions[] = [
    { label: '打开主窗口', click: () => { void lifecycle?.showWindow() } },
    { type: 'separator' },
    { label: '退出', click: () => { void requestAppQuit() } },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.on('click', () => { void lifecycle?.showWindow() })
}

function releaseAppQuit(): void {
  quitReleased = true
  hostLogStream?.end()
  hostLogStream = undefined
  tray?.destroy()
  tray = undefined
  app.quit()
}

/** Join explicit quit requests even while the Host or window is still starting. */
function requestAppQuit(): Promise<void> {
  if (lifecycle !== undefined) return lifecycle.requestQuit()
  bootQuitPromise ??= (host?.shutdown() ?? Promise.resolve()).catch((error: unknown) => {
    console.error('desktop shutdown failed:', error)
  }).then(() => {
    releaseAppQuit()
  })
  return bootQuitPromise
}

async function boot(): Promise<void> {
  if (bootQuitPromise !== undefined) return
  const paths = hostPaths()
  assertHostArtifactsPresent(paths)
  host = createHostSupervisor({
    spawnHost: () => spawnDshWeb({
      ...paths,
      env: {
        ...process.env,
        DSH_DESKTOP: '1',
      },
    }),
    log: createHostLogger(),
    onUnexpectedExit: ({ code, signal }) => {
      console.error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`)
      void dialog.showMessageBox({
        type: 'error',
        title: `${APP_NAME} 服务异常退出`,
        message: `本地 Harness 服务意外退出（code ${String(code)}, signal ${String(signal)}）。\n请重新启动应用。`,
      }).then(() => requestAppQuit())
    },
  })
  hostOrigin = await host.start()
  hardenSession()
  lifecycle = createDesktopLifecycle({
    getWindow: () => mainWindow,
    createWindow: createMainWindow,
    disposeHost: async () => { await host?.shutdown() },
    quit: releaseAppQuit,
    reportError: (error) => { console.error('desktop shutdown failed:', error) },
  })
  createTray()
  await lifecycle.showWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { void lifecycle?.showWindow() })
  app.on('activate', () => { void lifecycle?.showWindow() })
  app.on('window-all-closed', () => {
    // Tray and Host own application lifetime on every platform.
  })
  app.on('before-quit', (event: Event) => {
    if (quitReleased) return
    event.preventDefault()
    void requestAppQuit()
  })
  app.whenReady().then(boot).catch(async (error: unknown) => {
    console.error('desktop startup failed:', error)
    if (bootQuitPromise === undefined) {
      await dialog.showMessageBox({
        type: 'error',
        title: `${APP_NAME} 启动失败`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    await requestAppQuit()
  })
}
