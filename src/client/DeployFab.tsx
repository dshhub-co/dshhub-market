/**
 * 商城入口旁的「快捷部署」小按钮（shell.overlay）：火箭图标悬浮在商城
 * 胶囊上方。点击弹出小窗，列出已解锁的 kind=app 应用——数据来自
 * /dsh-market/unlocked（口令解锁记录展平）+ /dsh-market/installed
 * （已安装判断）+ /dsh-market/apps/status（运行态轮询）。
 *
 * 交互：未安装 → 点条目或「安装并部署」（装完自动起服务，浏览器新标签
 * 打开）；已安装未运行 → 「部署」；运行中 → 「打开」/「停止」。与解锁卡
 * 内的 app 按钮同一套后端路由，只是少了一步翻页找卡片。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Market.module.css'
import type { AppRunState, Translate, UnlockedBundle, UnlockedBundleItem } from './market-data.ts'

export interface DeployFabDeps {
  t: Translate
}

/** 火箭图标（线性描边，fill=currentColor 风格，随主题变色） */
function DeployIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  )
}

/** 展平后的可部署条目（kind=app 且未下架） */
interface DeployableApp {
  key: string
  item: UnlockedBundleItem
  bundleName: string
}

export function DeployFab({ t }: DeployFabDeps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [apps, setApps] = useState<DeployableApp[]>([])
  /** 已安装判断：package name → 版本（与解锁卡同一张 installed 地图） */
  const [installed, setInstalled] = useState<Record<string, string>>({})
  /** kind=app 运行态：name → 状态（打开弹窗期间 10s 轮询保活） */
  const [appRuns, setAppRuns] = useState<Record<string, AppRunState>>({})
  /** 处理中的应用 key（按钮转「处理中…」防连点） */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [u, i, s] = await Promise.all([
        fetch('/dsh-market/unlocked').then(r => r.json()).catch(() => ({ bundles: [] as UnlockedBundle[] })),
        fetch('/dsh-market/installed', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
        fetch('/dsh-market/apps/status', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      ])
      const bundles = ((u as { bundles?: UnlockedBundle[] }).bundles ?? [])
      const flat: DeployableApp[] = []
      for (const b of bundles) {
        for (const item of b.items) {
          if (item.kind !== 'app' || item.removed === true) continue
          const key = item.name ?? item.zip ?? item.url ?? ''
          if (key === '') continue
          flat.push({ key, item, bundleName: b.name })
        }
      }
      setApps(flat)
      setInstalled((i as { installed?: Record<string, string> }).installed ?? {})
      setAppRuns((s as { apps?: Record<string, AppRunState> }).apps ?? {})
      setLoadError(null)
    } catch (e) {
      setLoadError(String(e))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void refresh().finally(() => setLoading(false))
    const timer = setInterval(() => { void refresh() }, 10_000)
    return () => clearInterval(timer)
  }, [open, refresh])

  /** 部署（已安装、未运行）：起服务 + 浏览器新标签打开（用户手势内 window.open） */
  const doDeploy = useCallback((app: DeployableApp) => {
    const name = app.item.name ?? ''
    if (name === '') return
    setError(null)
    setBusy(app.key)
    fetch('/dsh-market/apps/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then(res => res.json().then(body => ({ status: res.status, body })))
      .then(({ status, body }) => {
        if (status === 200 && body.ok) {
          setAppRuns(prev => ({
            ...prev,
            [name]: { running: true, pid: body.pid, port: body.port, url: body.url, startedAt: body.startedAt },
          }))
          if (typeof body.url === 'string' && body.url !== '') window.open(body.url, '_blank', 'noopener')
        } else {
          setError(typeof body.error === 'string' ? body.error : `HTTP ${String(status)}`)
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setBusy(null))
  }, [])

  /** 安装（未安装）：走 /dsh-market/install，装完自动部署——一条龙「安装并部署」 */
  const doInstall = useCallback((app: DeployableApp) => {
    const url = app.item.zip ?? app.item.url
    if (typeof url !== 'string' || url === '') return
    setError(null)
    setBusy(app.key)
    fetch('/dsh-market/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(res => res.json().then(body => ({ status: res.status, body })))
      .then(({ status, body }) => {
        if (status === 200 && body.ok) {
          if (body.installed && typeof body.installed === 'object') {
            setInstalled(body.installed as Record<string, string>)
          }
          doDeploy(app)
        } else {
          setError(typeof body.error === 'string' ? body.error : `HTTP ${String(status)}`)
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setBusy(null))
  }, [doDeploy])

  /** 停止：应用进程退出，卡片回「部署」态 */
  const doStop = useCallback((app: DeployableApp) => {
    const name = app.item.name ?? ''
    if (name === '') return
    setError(null)
    setBusy(app.key)
    fetch('/dsh-market/apps/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then(res => res.json().then(body => ({ status: res.status, body })))
      .then(({ status, body }) => {
        if (status === 200 && body.ok) {
          setAppRuns(prev => ({ ...prev, [name]: { running: false } }))
        } else {
          setError(typeof body.error === 'string' ? body.error : `HTTP ${String(status)}`)
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setBusy(null))
  }, [])

  /** 点条目本体：未安装 → 安装并部署；已安装 → 部署或打开 */
  const act = useCallback((app: DeployableApp) => {
    const name = app.item.name ?? ''
    const running = name !== '' && appRuns[name]?.running === true
    if (running) {
      const url = appRuns[name]?.url
      if (typeof url === 'string' && url !== '') window.open(url, '_blank', 'noopener')
      return
    }
    if (installed[name] !== undefined) {
      doDeploy(app)
    } else {
      doInstall(app)
    }
  }, [appRuns, installed, doDeploy, doInstall])

  const isBusy = (app: DeployableApp) => busy === app.key
  const running = (app: DeployableApp) => {
    const name = app.item.name ?? ''
    return name !== '' && appRuns[name]?.running === true
  }

  return (
    <>
      <button
        className={css.deployFab}
        title={t('deployFabTitle')}
        aria-label={t('deployFabTitle')}
        onClick={() => setOpen(true)}
      >
        <DeployIcon />
      </button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={t('deployFabTitle')}
          closeLabel={t('deployFabTitle')}
          headless
          className={css.deployModalCard}
        >
          <div className={css.deployModalHead}>
            <span className={css.deployModalTitle}>{t('deployFabTitle')}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconCloseOutline16 size={16} />}
              aria-label={t('deployFabTitle')}
              onClick={() => setOpen(false)}
            />
          </div>
          <div className={css.deployModalBody}>
            {loading && apps.length === 0 ? (
              <div className={css.deployEmpty}>{t('deployLoading')}</div>
            ) : loadError !== null ? (
              <div className={css.deployEmpty}>{loadError}</div>
            ) : apps.length === 0 ? (
              <div className={css.deployEmpty}>{t('deployEmpty')}</div>
            ) : (
              <ul className={css.deployList}>
                {apps.map(app => (
                  <li key={app.key} className={css.deployItem}>
                    <button
                      type="button"
                      className={css.deployItemMain}
                      title={t('deployFabTitle')}
                      disabled={isBusy(app)}
                      onClick={() => act(app)}
                    >
                      <span className={css.deployItemName}>
                        {app.item.type === 'github' ? '🐙 ' : '📦 '}{app.item.name ?? app.item.url}
                        <span className={`${css.kindBadge} ${css.kindBadgeApp}`}>{t('kindApp')}</span>
                      </span>
                      <span className={css.deployItemStatus}>
                        {running(app) ? (
                          <>
                            <span className={css.appRunningDot} />
                            {t('appRunning').replace('{0}', String(appRuns[app.item.name ?? '']?.port ?? ''))}
                          </>
                        ) : installed[app.item.name ?? ''] !== undefined
                          ? t('deployInstalled')
                          : t('deployNotInstalled')}
                      </span>
                    </button>
                    <div className={css.deployActions}>
                      {running(app) ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={isBusy(app)}
                            onClick={() => {
                              const url = appRuns[app.item.name ?? '']?.url
                              if (typeof url === 'string' && url !== '') window.open(url, '_blank', 'noopener')
                            }}
                          >{t('appOpen')}</Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy(app)}
                            onClick={() => doStop(app)}
                          >{isBusy(app) ? t('appStopping') : t('appStop')}</Button>
                        </>
                      ) : installed[app.item.name ?? ''] !== undefined ? (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={isBusy(app)}
                          onClick={() => doDeploy(app)}
                        >{isBusy(app) ? t('appDeploying') : t('appDeploy')}</Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={isBusy(app)}
                          onClick={() => doInstall(app)}
                        >{isBusy(app) ? t('deployWorking') : t('deployInstallBtn')}</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {error !== null && <div className={css.deployError}>{error}</div>}
          </div>
        </Modal>
      )}
    </>
  )
}
