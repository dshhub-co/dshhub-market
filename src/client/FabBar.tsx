/**
 * 左下角轻量入口（shell.overlay）：单行细胶囊 = 商城 + 快捷部署两个小图标，
 * 中间一条发丝分割线。替代原先「彩色购物车胶囊 + 火箭圆钮」两个独立浮层
 * —— 不占两行、不抢眼，静默贴在侧边栏设置钮上方。
 *
 * 点购物车 → 内嵌市场面板（复用设置页同一个 MarketSection）；
 * 点火箭 → DeployPanel（一键安装/部署/停止/打开 kind=app）。
 * 弹层用 headless Modal：卡片内部全由自己排版。
 */
import { useState, type ComponentProps } from 'react'
import { Button, IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Market.module.css'
import { DeployIcon, DeployPanel } from './DeployFab.tsx'
import { MarketSection } from './MarketSection.tsx'
import type { Translate } from './market-data.ts'

export interface FabBarDeps {
  t: Translate
  /** MarketSection 的宿主依赖，与设置页注册处同一来源 */
  market: Omit<ComponentProps<typeof MarketSection>, 't'>
}

/** 购物车图标（线性描边，fill=currentColor 风格，随主题变色） */
function CartIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2l2.6 11.4a1.5 1.5 0 0 0 1.5 1.1h8.9a1.5 1.5 0 0 0 1.5-1.2L21 8H6" />
    </svg>
  )
}

export function FabBar({ t, market }: FabBarDeps) {
  const [panel, setPanel] = useState<'market' | 'deploy' | null>(null)
  return (
    <>
      <div className={css.fabBar}>
        <button
          className={css.fabBarBtn}
          title={t('fabTitle')}
          aria-label={t('fabTitle')}
          onClick={() => setPanel('market')}
        >
          <CartIcon />
        </button>
        <span className={css.fabBarDivider} />
        <button
          className={css.fabBarBtn}
          title={t('deployFabTitle')}
          aria-label={t('deployFabTitle')}
          onClick={() => setPanel('deploy')}
        >
          <DeployIcon size={17} />
        </button>
      </div>
      {panel === 'market' && (
        <Modal
          open
          onClose={() => setPanel(null)}
          title={t('fabModalTitle')}
          closeLabel={t('fabModalTitle')}
          headless
          className={css.fabModalCard}
        >
          <div className={css.fabModalHead}>
            <span className={css.fabModalTitle}>{t('fabModalTitle')}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconCloseOutline16 size={16} />}
              aria-label={t('fabModalTitle')}
              onClick={() => setPanel(null)}
            />
          </div>
          <div className={css.fabModalPanel}>
            <MarketSection t={t} {...market} />
          </div>
        </Modal>
      )}
      {panel === 'deploy' && <DeployPanel t={t} onClose={() => setPanel(null)} />}
    </>
  )
}
