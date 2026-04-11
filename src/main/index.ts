import { app, BrowserWindow, shell, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import Store from 'electron-store'

let mainWindowRef: BrowserWindow | null = null

const store = new Store<{ windowBounds: Electron.Rectangle }>()
const secureStore = new Store<Record<string, string>>({ name: 'secure-settings' })

type LegacyRuntimeStatus = {
  running: boolean
  pid?: number
  command?: string
  lastError?: string
}

let legacyProcess: ChildProcessWithoutNullStreams | null = null
let legacyStatus: LegacyRuntimeStatus = { running: false }

type WebSearchResult = { title: string; snippet: string; url: string }

function splitArgs(raw: string): string[] {
  return raw
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)
}

function isTrustedAppOrigin(origin?: string): boolean {
  const value = (origin || '').toLowerCase()
  return (
    value.startsWith('file://') ||
    value.startsWith('http://localhost:') ||
    value.startsWith('http://127.0.0.1:') ||
    value.startsWith('https://localhost:') ||
    value.startsWith('https://127.0.0.1:')
  )
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
}

function stripHtml(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function extractDuckDuckGoTargetUrl(rawUrl: string): string {
  const decoded = decodeHtmlEntities(rawUrl)
  const normalized = decoded.startsWith('//') ? `https:${decoded}` : decoded

  try {
    const url = new URL(normalized)
    const direct = url.searchParams.get('uddg')
    return direct ? decodeURIComponent(direct) : normalized
  } catch {
    return normalized
  }
}

function parseDuckDuckGoHtmlResults(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const blocks = html.split('<div class="links_main links_deep result__body">')

  for (const block of blocks.slice(1)) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
    const title = stripHtml(titleMatch[2])
    const snippet = stripHtml(snippetMatch?.[1] ?? '')
    const url = extractDuckDuckGoTargetUrl(titleMatch[1])

    if (!title || !url) continue
    results.push({ title, snippet, url })
    if (results.length >= maxResults) break
  }

  return results
}

async function searchDuckDuckGoInstant(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Web search failed (${res.status})`)

  const data = await res.json() as {
    AbstractText?: string
    AbstractURL?: string
    Heading?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>
  }

  const flat: WebSearchResult[] = []
  if (data.AbstractText) {
    flat.push({
      title: data.Heading || 'Result',
      snippet: data.AbstractText,
      url: data.AbstractURL || '',
    })
  }

  for (const item of data.RelatedTopics ?? []) {
    if ('Topics' in item && Array.isArray(item.Topics)) {
      for (const sub of item.Topics) {
        if (sub.Text) flat.push({ title: 'Related', snippet: sub.Text, url: sub.FirstURL || '' })
      }
    } else if ('Text' in item && item.Text) {
      flat.push({ title: 'Related', snippet: item.Text, url: item.FirstURL || '' })
    }
  }

  return flat
    .filter(item => item.title && item.url)
    .slice(0, Math.max(1, Math.min(maxResults, 10)))
}

async function searchDuckDuckGoHtml(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    },
  })
  if (!res.ok) throw new Error(`Web HTML search failed (${res.status})`)
  const html = await res.text()
  return parseDuckDuckGoHtmlResults(html, Math.max(1, Math.min(maxResults, 10)))
}

function createWindow(): void {
  const saved = store.get('windowBounds', { width: 1200, height: 800, x: undefined, y: undefined } as unknown as Electron.Rectangle)

  const iconPath = join(__dirname, '../../resources/icon.png')
  const appIcon = nativeImage.createFromPath(iconPath)

  const mainWindow = new BrowserWindow({
    width:  saved.width  ?? 1200,
    height: saved.height ?? 800,
    x: saved.x,
    y: saved.y,
    minWidth:  840,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#0F0F1A',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  })
  mainWindowRef = mainWindow

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
    }
  })

  // Save window position/size on resize/move
  const saveBounds = (): void => {
    store.set('windowBounds', mainWindow.getBounds())
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move',   saveBounds)

  mainWindow.on('ready-to-show', () => mainWindow.show())

  const ses = mainWindow.webContents.session
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!isTrustedAppOrigin(requestingOrigin)) return false
    return permission === 'media' || permission === 'speaker-selection'
  })
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const candidateOrigin = 'requestingUrl' in details
      ? details.requestingUrl
      : 'securityOrigin' in details
        ? details.securityOrigin
        : ''
    callback(isTrustedAppOrigin(candidateOrigin) && (permission === 'media' || permission === 'speaker-selection'))
  })

  // Open external links in the system browser (security: never in-app)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:runtimeMode', () => (app.isPackaged ? 'packaged' : 'dev'))
ipcMain.handle('secret:get', (_e, key: string) => secureStore.get(key, ''))
ipcMain.handle('secret:set', (_e, key: string, value: string) => {
  secureStore.set(key, value)
})
ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
ipcMain.handle('web:search', async (_e, query: string, maxResults = 5) => {
  const q = query.trim()
  if (!q) return []
  const safeMaxResults = Math.max(1, Math.min(maxResults, 10))
  const instant = await searchDuckDuckGoInstant(q, safeMaxResults)
  if (instant.length > 0) return instant
  return searchDuckDuckGoHtml(q, safeMaxResults)
})

ipcMain.handle('legacy:status', () => legacyStatus)
ipcMain.handle('legacy:start', async (_e, payload?: { command?: string; args?: string; cwd?: string }) => {
  if (legacyProcess && !legacyProcess.killed) {
    return legacyStatus
  }

  const command = payload?.command?.trim() || ''
  const args = splitArgs(payload?.args || '')
  const cwd = payload?.cwd?.trim() || undefined

  if (!command) {
    legacyStatus = { running: false, lastError: 'Comando vacío para runtime legacy.' }
    return legacyStatus
  }

  try {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      windowsHide: true,
    })
    legacyProcess = child
    legacyStatus = {
      running: true,
      pid: child.pid,
      command: `${command} ${args.join(' ')}`.trim(),
      lastError: undefined,
    }

    child.stderr.on('data', (data) => {
      const msg = String(data || '').trim()
      if (msg) legacyStatus.lastError = msg.slice(0, 280)
    })

    child.on('exit', (code, signal) => {
      legacyStatus = {
        running: false,
        command: legacyStatus.command,
        lastError: code === 0 ? legacyStatus.lastError : `Legacy runtime terminó (code=${code}, signal=${signal || 'none'})`,
      }
      legacyProcess = null
    })

    child.on('error', (err) => {
      legacyStatus = {
        running: false,
        command: legacyStatus.command,
        lastError: err.message,
      }
      legacyProcess = null
    })

    return legacyStatus
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    legacyStatus = { running: false, lastError: msg }
    legacyProcess = null
    return legacyStatus
  }
})

ipcMain.handle('legacy:stop', async () => {
  if (legacyProcess && !legacyProcess.killed) {
    legacyProcess.kill()
  }
  legacyProcess = null
  legacyStatus = {
    running: false,
    command: legacyStatus.command,
    lastError: legacyStatus.lastError,
  }
  return legacyStatus
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindowRef) return
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.focus()
  })

  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (legacyProcess && !legacyProcess.killed) {
    legacyProcess.kill()
    legacyProcess = null
  }
})
