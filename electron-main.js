/**
 * ✂️ 무음 제거 에디터 - Electron Main Process
 */
const { app, BrowserWindow, shell, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow = null;

// 내장 Express 서버 직접 실행 (메인 프로세스 내부에서 구동되므로 별도 node.exe 불필요)
try {
    require('./server.js');
    console.log('[Electron] 내장 서버 실행 완료');
} catch (err) {
    console.error('[Electron] 내장 서버 실행 오류:', err);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        title: '✂️ 무음 제거 에디터',
        icon: path.join(__dirname, 'public', 'icon.ico'),
        backgroundColor: '#0b1329',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    mainWindow.setMenuBarVisibility(false);

    // F12 개발자 도구 단축키 등록
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    // 서버가 뜰 때까지 대기 후 로드
    const tryLoad = (attempt = 0) => {
        http.get('http://localhost:4009/health', (res) => {
            mainWindow.loadURL('http://localhost:4009');
            mainWindow.once('ready-to-show', () => {
                mainWindow.show();
            });
        }).on('error', () => {
            if (attempt < 40) {
                setTimeout(() => tryLoad(attempt + 1), 250);
            } else {
                mainWindow.loadURL('http://localhost:4009');
                mainWindow.show();
            }
        });
    };

    tryLoad();

    // 외부 링크는 기본 브라우저로 열기
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
