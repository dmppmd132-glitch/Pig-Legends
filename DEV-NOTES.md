# Pig Legends — 開發進度筆記（內部）

路徑 `/home/ubuntu/Pig-Legends`；Node 22；Vite 7.3.8 + React 19.3.1 + TS 5.9.3 + Babylon 9.37 + vite-plugin-pwa 2.0.0 + idb 8.0.4。
GitHub：`dmppmd132-glitch/Pig-Legends`（既有 repo）。Pages：`https://dmppmd132-glitch.github.io/Pig-Legends/`，Vite `base='/Pig-Legends/'`。

## 已查證的外部事實（避免重複查證）

### Babylon 9.37（node_modules 實測）
- 深度匯入需手動補副作用：`Lights/Shadows/shadowGeneratorSceneComponent.js`、
  `Meshes/instancedMesh.js`（否則 `mesh.createInstance()` 拋
  "InstancedMesh needs to be imported before as it contains a side-effect required by your code."）。
- `Meshes/meshBuilder.js` 已內含所有 Builders；`Layers/glowLayer.js` 自行註冊 EffectLayerSceneComponent。
- 型別-only 匯入可安全用 barrel（會被完全擦除，不影響體積）。
- `Matrix` 在 `Maths/math.vector`，`Viewport` 在 `Maths/math.viewport`。
- `Scene` 沒有 `getFps()` → 用 `scene.getEngine().getFps()`。
- `Camera.forwardDirection` 在 FreeCamera 上可能是 undefined → 用 `camera.rotation.y`。
- 粒子混合常數在 `BaseParticleSystem.BLENDMODE_ADD`（不是 Constants）。
- ParticleSystem **沒有** `parent`、`particleSizeScale`、`getIsStarted()`；用 `isStarted()`。
  單發粒子：`emitRate = 0` + `manualEmitCount`，不要 setTimeout 停。

### vite-plugin-pwa 2.0.0
- 虛擬模組必須**靜態**匯入：`import { registerSW } from 'virtual:pwa-register'` 或
  `import { useRegisterSW } from 'virtual:pwa-register/react'`。
  用變數動態 `import(SW_IMPORT)` 不會被 Vite 解析 → 瀏覽器當成相對 URL → CORS 錯誤（實測發生過）。
- React 綁定回傳 `{ needRefresh:[bool,setter], offlineReady:[bool,setter], updateServiceWorker(reload) }`。
- 型別由 `/// <reference types="vite-plugin-pwa/client" />` 提供（client.d.ts 已含 react）。

### idb 8.0.4
- `openDB` 的 `upgrade(db, oldVersion, newVersion, tx)` 內**不能**呼叫 `db.put(...)`：
  會拋 "A version change transaction is running."。要用 `tx.objectStore(name).put(...)`。

### 工具/環境
- 沙箱有 `/usr/bin/chromium` + python playwright（`sync_playwright`）。
  啟動需 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，
  且加 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling`，否則 rAF 被節流。
- 軟體渲染只有 1~6 fps；`dt` 上限 0.05 → 模擬時間以 0.05×fps 速度前進（測試需拉長 real time）。
- Manus 託管瀏覽器工具的 console JS 跑在**隔離 world**，讀不到頁面全域（`window.pigDebug` 取不到）；
  DOM 可讀。所以互動驗證改用沙箱內 playwright。
- 託管瀏覽器 WebGL 頁面點擊後常被重設為 about:blank。
- `vite preview` 會擋轉傳網域（需 preview.allowedHosts）→ 用 `scripts/serve-dist.py`（模擬 Pages 子路徑 + no-store）。

## 已驗證可用的功能（playwright 數據）
- 0 console errors；tsc 0 error；build 成功。
- Bundle：babylon 2.10 MB (gzip 481 KB)、react 222 KB、game 90 KB；precache 2.75 MB。
- 開機 → 主選單（畫面背後為即時 3D 森林）→ `?mode=hunt` 自動開局 → HUD 正常（120/120、100 wind、計數、計時、toast）。
- 移動：按住 Shift+W 8 秒，ARNO 實際位移 5.06 m，狀態 idle→run。
- 狼 AI：alert → stalk → recover，會移動；`activeMeshes ≈ 200`。
- PWA：Install dock 出現（beforeinstallprompt 可用）。
- 已修：InstancedMesh 副作用、applySettings 於 boot 前崩潰、巨大螢火蟲粒子（縮小+壓暗+降低高度帶）、
  薄霧地平線過亮（改 applyFog + 降 alpha）、地面/角色過暗（hemi .52、moon 1.5、新增跟隨提燈 1.35/9.5m）、
  PWA 虛擬模組 CORS、IDB 版本交易。

## 目前發現的下一個真 bug（進行中）
**快速按下按鍵會遺失**：`InputSystem` 以「這一幀 down 且上一幀 up」偵測邊界，
一次 down+up 若落在同一幀內就完全不会被看到（370 次 J 敲擊 0 次命中，且角色 stamina 未扣）。
修復方向：為鍵盤/滑鼠加 input buffer（时间戳 + 過期窗口 ~200ms），
並在 paused 時也要 polling input（否則 Esc 無法解除暫停）。

## 待辦
- [ ] input buffer + paused 時輸入polling
- [ ] 重建後重跑 combat.py 確認命中、扣耐力、狼硬直、死亡、重生、過關
- [ ] 手機模擬（--mobile）確認搖桿/按鈕出現且可操作
- [ ] `.github/workflows/deploy.yml`（GitHub 官方 Pages Actions）、README.md、.gitignore
- [ ] GitHub OAuth 連接 → push main → Pages Source = GitHub Actions
- [ ] 驗證正式 Pages URL 與離線安裝
