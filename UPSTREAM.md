# UPSTREAM — dsh-market fork 记录

本目录是 [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) 的 fork，
作为 dshhub 的核心市场轮子（DSH 内插件市场），MIT 许可。

- **源仓库**：https://github.com/dsh-market/dsh-market
- **vendor 基线**：v1.15.0，commit `e23bf755f4df64be8ce575bd52090b2c9bdad526`（2026-08-19 "release 1.15.0"）
- **vendor 日期**：2026-08-20
- **排除项**：`.git`、`node_modules`、`site/`、`.github/`、`*.tgz`、`data/readmes-snapshot.json`

## fork 改动清单（重同步时必须重放）

1. **身份**（避让官方 dshmarket，包名保持 `dshhub-market`）：
   - `cordis.patch.yml`：`id: market / name: 'dshhub-market'`（id 沿用 legacy 值，防与官方 `dsh-market` 撞 loader-entry）
   - `tsdown.config.ts`：`const id = 'dshhub-market'`
   - `src/index.ts`：cordis plugin name → `'dshhub-market'`
   - `src/settings.ts`：settings NS → `dshhub-market`
   - `src/hot.ts`：`HOT_DIR` → `.dshhub-market`
   - `src/routes.ts`：`SELF_NAMES` 加 `'dshhub-market'`
   - `src/groups.ts`：skip 列表加 `'dshhub-market'`
   - `src/client/index.ts`：NS/name/toast id → dshhub-market
   - `src/client/SettingsCard.tsx`：own-row 查找 + update body name
   - `package.json`：name=dshhub-market、version=0.6.0、homepage/repository → dshhub、deps 加 fflate
2. **目录源**：`src/registry.ts` 默认 `REGISTRY_URL` → `https://www.dshhub.co/api/registry/plugins.json`（DSHM_REGISTRY_URL 覆盖保留）；`RegistryPlugin` 增 `zip?/dshhubId?/host?/page?`
3. **zip 安装通道**：新增 `src/zip-source.ts`（zip→tgz 重打 + 内容寻址缓存），`src/routes.ts` 安装路由 zip 分支，`src/updates.ts` 绝对路径 spec 按 linked 处理
4. **本地桥接**：新增 `src/bridge.ts`（127.0.0.1:3750-3754 /health + /install），新增 `src/install-entry.ts`（安装路由主体抽取，路由与桥接共用）
5. **自更新**：`src/index.ts` apply() 定时器 → `/api/market/version` → tgz 重装；update 路由与 checkUpdates 对 SELF 走版本端点（不走 npm）
6. **品牌**：`src/client/locales.ts` nav/subtitle → DSHHub.co；MarketSection 头像守卫（非 github owner 跳过）+ `host==='dshhub'` 徽章 + 页脚链接 → dshhub.co；日志前缀 `[dshhub-market]`；settings.section slot id → `dshhub-market`（避免与官方 dshmarket 的 `market` 撞）；**legacy 侧边栏 MarketLauncher 不移植**（fork 的市场本体在设置页，modal 入口无对应物——待办）
7. **包管理**：只用 npm（`package-lock.json`），删掉了 `pnpm-lock.yaml`（pnpm 严格隔离会让 `@deepseek-ai/schemastery` 等传递依赖不可见，上游主流程是 npm）；`package.json` 加 `pnpm.onlyBuiltDependencies: []` 只是防 pnpm 误装时拒绝 build scripts

## 重同步流程（上游发新版本时）

1. 记录当前上游最新 tag/SHA，`git log -1` 对比 `UPSTREAM.md` 基线。
2. 下载新版 tarball，解压后 rsync 覆盖 `market/`（排除同上）。
3. 重放上面 1-6 的 fork 改动（diff 基线版本与当前版本对照）。
4. `pnpm install --registry=https://registry.npmjs.org`（npmmirror 会 404 新包，别用）。
5. `npm run typecheck && npx vitest run && node scripts/preflight.mjs` 全绿。
6. `npm run pack:market`（根目录）重打包 `public/dshhub-market.tgz`，提交 `market/client/client.js`。
7. 更新本文件基线与日期。

## 拆仓记录

- **2026-08-21**：`market/` 从 dshhub 主仓拆出为独立仓库 [dshhub-co/dshhub-market](https://github.com/dshhub-co/dshhub-market)。
  主仓的 `pack:market` 改为从 npm 拉取本包重新打包 `public/dshhub-market.tgz`；版本端点
  `/api/market/version` 改读主仓内置的 `lib/market-version.json`（由打包脚本同步）。
