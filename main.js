const {app, BrowserWindow, BrowserView, Menu, globalShortcut, ipcMain} = require('electron');
const path = require('node:path');
let win;
let views = [];     // 存放所有 BrowserView
let activeIndex = 0; // 当前激活的标签索引

// 窗口大小变化时调整所有 BrowserView 大小和位置
function resizeViews() {
    const toolbarHeight = 70;  // 多标签页 + 地址栏区高度
    const [w, h] = win.getContentSize();
    views.forEach(view => {
        view.setBounds({x: 0, y: toolbarHeight, width: w, height: h - toolbarHeight});
    });
}

function createView(url) {
    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    view.webContents.loadURL(url);
    /* === 追加这段拖文件导航拦截 === */
    view.webContents.on('will-navigate', (e, targetUrl) => {
        // 把本地 html 拖进正文时会触发
        if (targetUrl.startsWith('file://')) {
            e.preventDefault();              // 阻止 Chromium 默认处理
            view.webContents.loadURL(targetUrl); // 手动导航
        }
    });

    // 右键菜单
    view.webContents.on('context-menu', (event, params) => {
        const menu = Menu.buildFromTemplate([
            {
                label: '审查元素', click: () =>
                    view.webContents.inspectElement(params.x, params.y)
            },
            {type: 'separator'},
            {role: 'reload'},
            {role: 'copy'},
            {role: 'paste'},
        ]);
        menu.popup();
    });

    return view;
}

function create(startUrl = 'https://www.baidu.com/') {
    console.log("开始咯");

    function bindViewEvents(view, idx) {
        const sync = () => {
            if (idx === activeIndex) {
                win.webContents.send('update-url', view.webContents.getURL());
            }
            updateTabs();
        };
        view.webContents.on('did-navigate', sync);
        view.webContents.on('did-navigate-in-page', sync);
        view.webContents.on('page-title-updated', updateTabs);
    }

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            preload: __dirname + '/preload.js'
        }
    });

    const toolbarHeight = 70;

    // 创建第一个标签页
    const firstView = createView(startUrl);
    bindViewEvents(firstView, 0);         // ★ 给第 0 个绑定
    views.push(firstView);
    win.setBrowserView(firstView);

    // 调整视图大小
    resizeViews();
    win.on('resize', resizeViews);

    // 载入顶部 HTML，包含多标签页和地址栏
    win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(`
      <style>
        body {
          margin: 0; padding: 0;
          font-family: sans-serif;
          user-select: none;
        }
        #tabs {
          height: 30px;
          background: #eee;
          display: flex;
          align-items: center;
          padding: 0 10px;
          overflow-x: auto;
          white-space: nowrap;
        }
        .tab {
          padding: 5px 10px;
          margin-right: 4px;
          background: #ccc;
          border-radius: 4px 4px 0 0;
          cursor: pointer;
        }
        .tab.active {
          background: white;
          border-bottom: 2px solid white;
          font-weight: bold;
        }
        #add-tab {
          font-weight: bold;
          cursor: pointer;
          user-select: none;
          padding: 5px 10px;
          background: #ddd;
          border-radius: 4px;
        }
        #toolbar {
          height: 40px;
          background: #ddd;
          padding: 5px 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #addr {
          flex-grow: 1;
          height: 28px;
          font-size: 14px;
          min-width: 200px;
        }
        button {
          height: 28px;
        }
      </style>
      <body>
        <div id="tabs"></div>
        <div id="toolbar">
          <input id="addr" placeholder="输入网址，回车或点击 Go" />
          <button id="go-btn">Go</button>
        </div>

        <script>
          const ipc = window.api; 

          let activeIndex = 0;
          let tabs = [];

          const tabsDiv = document.getElementById('tabs');
          const addrInput = document.getElementById('addr');
          const goBtn = document.getElementById('go-btn');

       function renderTabs() {
          tabsDiv.innerHTML = '';
          tabs.forEach((tab, i) => {
            const tabEl = document.createElement('div');
            tabEl.className = 'tab' + (i === activeIndex ? ' active' : '');
            tabEl.textContent = tab.title || '新标签';
        
            /* —— 关闭按钮 —— */
            const close = document.createElement('span');
            close.textContent = ' ✕';
            close.style.cssText = 'margin-left:6px; color:#900; cursor:pointer;';
            close.onclick = e => {
              e.stopPropagation();           // 不触发切换
              ipc.send('close-tab', i);      // 通知主进程关闭
            };
            tabEl.appendChild(close);
        
            tabEl.onclick = () => {          // 标签切换
              if (i !== activeIndex) {
                activeIndex = i;
                ipc.send('switch-tab', i);
                renderTabs();
              }
            };
            tabsDiv.appendChild(tabEl);
          });
        
          /* “＋” 按钮 */
          const addBtn = document.createElement('div');
          addBtn.id = 'add-tab';
          addBtn.textContent = '+';
          addBtn.title = '新建标签页';
          addBtn.onclick = () => ipc.send('new-tab');
          tabsDiv.appendChild(addBtn);
        }
          function updateAddress(url) {
            addrInput.value = url;
          }

          // 点击 Go 或回车，发送导航请求
          function navigate() {
            const url = addrInput.value.trim();
            if (url) ipc.send('nav', url);
          }
          goBtn.onclick = navigate;
          addrInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') navigate();
          });

          // ipc 监听更新地址栏
          ipc.on('update-url', (url) => {
            updateAddress(url);
          });

          // ipc 监听更新标签标题
          ipc.on('update-tab-title', ({ index, title }) => {
            while (tabs.length <= index) tabs.push({});   // ← 如需占位就 push
            tabs[index].title = title || '新标签';
            renderTabs();
          });

          // ipc 监听初始化标签列表和激活标签
          ipc.on('init-tabs', ({ tabs: newTabs, active }) => {
            tabs = newTabs;
            activeIndex = active;
            renderTabs();
          });
           
           // === 全局拖拽文件到窗口 ===
          document.addEventListener('dragover', e => e.preventDefault());
          document.addEventListener('drop', e => {
            e.preventDefault();
            if (e.dataTransfer.files.length) {
              // 只取第一个文件路径
              window.api.send('nav', e.dataTransfer.files[0].path);
            }
          });
          // 首次请求初始化标签数据
          ipc.send('request-init-tabs');
          ipc.on('active-tab', idx => { activeIndex = idx; renderTabs(); });
        </script>
      </body>
    `));

    // ipc 事件处理

    // 关闭标签
    ipcMain.on('close-tab', (_e, idx) => {
        if (idx < 0 || idx >= views.length) return;

        // 销毁并从数组移除
        const [removed] = views.splice(idx, 1);
        removed.webContents.destroy();

        // 调整 activeIndex
        if (activeIndex >= views.length) activeIndex = views.length - 1;
        if (activeIndex < 0 && views.length) activeIndex = 0;

        // 如果还有标签，显示当前；否则新建一个空白页
        if (views.length) {
            win.setBrowserView(views[activeIndex]);
            resizeViews();
            win.webContents.send('update-url', views[activeIndex].webContents.getURL());
        } else {
            const blank = createView('about:blank');
            views.push(blank);
            activeIndex = 0;
            win.setBrowserView(blank);
            resizeViews();
            win.webContents.send('update-url', 'about:blank');
        }
        // 这里新增：告诉渲染进程更新标签和激活状态
        win.webContents.send('init-tabs', {
            tabs: views.map(v => ({title: v.webContents.getTitle() || '新标签'})),
            active: activeIndex
        });
        // 更新标题和高亮
        updateTabs();
        win.webContents.send('active-tab', activeIndex);

        // 只解绑我们自己绑定的事件，避免清除右键菜单等其他事件
        views.forEach((v, i) => {
            v.webContents.removeAllListeners('did-navigate');
            v.webContents.removeAllListeners('did-navigate-in-page');
            v.webContents.removeAllListeners('page-title-updated');
            bindViewEvents(v, i);
        });
    });

    // 新建标签
    ipcMain.on('new-tab', () => {
        const v = createView('https://www.baidu.com/');
        bindViewEvents(v, views.length);   // ★ 关键：绑定监听并传当前索引
        views.push(v);
        switchTab(views.length - 1);
    });

    // 切换标签
    ipcMain.on('switch-tab', (_, index) => {
        if (index >= 0 && index < views.length) {
            switchTab(index);
        }
    });

    // 导航当前标签
    ipcMain.on('nav', (_e, raw) => {
        const view = views[activeIndex];
        let target = raw.trim();

        // A) 已带协议 http / https / file
        if (/^[a-z]+:\/\//i.test(target)) {
            /* do nothing */
        }
        // B) 绝对路径（Windows “C:\” 或 *nix “/”）
        else if (/^[a-zA-Z]:[\\/]/.test(target) || path.isAbsolute(target)) {
            target = 'file://' + path.resolve(target).replace(/\\/g, '/');
        }
        // C) 其它文本按域名处理
        else {
            target = 'https://' + target;
        }

        view.webContents.loadURL(target);
    });
    // 初始化标签数据给渲染层
    ipcMain.on('request-init-tabs', (event) => {
        event.sender.send('init-tabs', {
            tabs: views.map(v => ({title: v.webContents.getTitle() || '新标签'})),
            active: activeIndex
        });
    });

    // 切换标签的实际函数
    function switchTab(index) {
        if (index === activeIndex) return;
        if (views[activeIndex]) win.removeBrowserView(views[activeIndex]);
        activeIndex = index;
        win.setBrowserView(views[activeIndex]);
        resizeViews();

        // 更新地址栏URL
        const url = views[activeIndex].webContents.getURL();
        win.webContents.send('update-url', url);
        // 更新标签栏
        updateTabs();
        // 额外广播激活索引
        win.webContents.send('active-tab', activeIndex);
    }

    // 更新所有标签标题（每次页面加载完成时更新）
    function updateTabs() {
        views.forEach((view, i) => {
            view.webContents.executeJavaScript('document.title').then(title => {
                win.webContents.send('update-tab-title', {index: i, title: title || '新标签'});
            });
        });
    }

    // 注册快捷键 Ctrl+Shift+I 打开/关闭开发者工具
    const ok = globalShortcut.register('Ctrl+Shift+I', () => {
        if (views[activeIndex]) {
            if (views[activeIndex].webContents.isDevToolsOpened()) {
                views[activeIndex].webContents.closeDevTools();
            } else {
                views[activeIndex].webContents.openDevTools({mode: 'detach'});
            }
        }
    });
    console.log('Ctrl+Shift+I 注册结果:', ok);

    Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
    create();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
