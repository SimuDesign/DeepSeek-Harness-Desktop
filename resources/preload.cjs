/**
 * dsh-desktop preload (sandboxed renderer).
 *
 * Exposes the on-disk path of a picked file to the web UI so plugins can hand
 * binary files (PDF, spreadsheets, …) to the agent as a path reference
 * instead of raw bytes — the agent then reads them with its own fs/tool
 * stack, which already has the same access. Nothing else is exposed.
 */
const { contextBridge, webUtils } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  /** Resolve the real path of a <input type="file"> File, or null. */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
})
