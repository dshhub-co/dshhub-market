/**
 * 左下角插件市场入口（shell.overlay）：购物车图标 + 「插件市场」文字胶囊，
 * 悬浮在侧边栏设置按钮上方（host 的 sidebar 槽全是 single 槽，插件不能往
 * 设置上方塞真正的侧边栏条目，悬浮胶囊是官方 shell.overlay 通道下的等价物）。
 * 点击弹出内嵌的市场面板——复用设置页同一个 MarketSection。
 *
 * 弹层用 headless Modal：卡片内部全由自己排版（默认 chrome 的内容区会挤压
 * MarketSection 的网格，出现过安装按钮文字溢出卡片的情况）。
 */
import { useState, type ComponentProps } from 'react'
import { Button, IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Market.module.css'
import { MarketSection } from './MarketSection.tsx'
import type { Translate } from './market-data.ts'

export interface StoreFabDeps {
  t: Translate
  /** MarketSection 的宿主依赖，与设置页注册处同一来源 */
  market: Omit<ComponentProps<typeof MarketSection>, 't'>
}

/** 购物车图标（线性描边，fill=currentColor 风格，随主题变色） */
function CartIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2l2.6 11.4a1.5 1.5 0 0 0 1.5 1.1h8.9a1.5 1.5 0 0 0 1.5-1.2L21 8H6" />
    </svg>
  )
}

export function StoreFab({ t, market }: StoreFabDeps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className={css.fab}
        title={t('fabTitle')}
        aria-label={t('fabTitle')}
        onClick={() => setOpen(true)}
      >
        <CartIcon />
        <span className={css.fabLabel}>{t('fabLabel')}</span>
      </button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
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
              onClick={() => setOpen(false)}
            />
          </div>
          <div className={css.fabModalPanel}>
            <MarketSection t={t} {...market} />
          </div>
        </Modal>
      )}
    </>
  )
}
