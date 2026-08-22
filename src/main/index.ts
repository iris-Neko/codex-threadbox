import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { AppServerClient } from './app-server-client'
import { CodexRuntime } from './codex-runtime'
import { registerIpcHandlers } from './ipc'
import { SettingsStore } from './settings-store'
import { ThreadService } from './thread-service'

let mainWindow: BrowserWindow | null = null
let appServerClient: AppServerClient | null = null

function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f6f7',
    title: 'Threadbox for Codex',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const settings = new SettingsStore()
  const runtime = new CodexRuntime(settings)
  appServerClient = new AppServerClient(runtime)
  const threadService = new ThreadService(appServerClient)
  registerIpcHandlers(threadService, settings, runtime, appServerClient)

  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  appServerClient?.stop()
})
