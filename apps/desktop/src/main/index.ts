import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { startBackend } from '@desktop-claw/backend'

let ballWin: BrowserWindow | null = null

/** 拖拽时记录光标相对于窗口左上角的偏移量 */
let dragOffset = { x: 0, y: 0 }

function createBallWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  ballWin = new BrowserWindow({
    width: 72,
    height: 72,
    x: width - 96,
    y: height - 96,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // macOS: floating 层级 — 浮于普通窗口之上，不遮挡全屏
  ballWin.setAlwaysOnTop(true, 'floating')

  ballWin.on('ready-to-show', () => ballWin?.show())

  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    ballWin.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    ballWin.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC: 悬浮球拖拽 ────────────────────────────────────────
ipcMain.on('drag:start', () => {
  if (!ballWin) return
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = ballWin.getPosition()
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
})

ipcMain.on('drag:move', () => {
  if (!ballWin) return
  const { x, y } = screen.getCursorScreenPoint()
  ballWin.setPosition(
    Math.round(x - dragOffset.x),
    Math.round(y - dragOffset.y)
  )
})

ipcMain.on('drag:end', () => {
  // TODO: 持久化位置到 config.json（Milestone B）
})

// ── IPC: 调试 ──────────────────────────────────────────────
ipcMain.handle('ipc:ping', () => {
  console.log('[main] received ping from renderer')
  return 'pong from main 🐾'
})

// ── 启动内嵌后端 ───────────────────────────────────────────
startBackend().catch((err: unknown) => {
  console.error('[main] Failed to start backend:', err)
})

// ── App 生命周期 ───────────────────────────────────────────
app.whenReady().then(() => {
  createBallWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBallWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
