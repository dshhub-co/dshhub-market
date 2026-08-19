/**
 * 右下角商城入口（shell.overlay）：DSH 主页右下角的悬浮按钮，
 * 点击弹出内嵌的市场面板——复用设置页同一个 MarketSection，
 * 搜索、三档分类、一键安装都在，不依赖宿主打开设置对话框的 API。
 */
import { useState, type ComponentProps } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Market.module.css'
import { MarketSection } from './MarketSection.tsx'
import type { Translate } from './market-data.ts'

export interface StoreFabDeps {
  t: Translate
  /** MarketSection 的宿主依赖，与设置页注册处同一来源 */
  market: Omit<ComponentProps<typeof MarketSection>, 't'>
}

/** 与设置页头部一致的市场图形标（官方风格单色，fill=currentColor）。 */
function MarketGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="currentColor">
        <rect x="1.96" y="3.36" width="3.3" height="3.3" rx="0.53" />
        <rect x="5.71" y="3.36" width="3.3" height="3.3" rx="0.53" />
        <rect x="1.96" y="7.11" width="3.3" height="3.3" rx="0.53" />
        <rect x="5.71" y="7.11" width="3.3" height="3.3" rx="0.53" />
        <rect x="9.46" y="7.11" width="3.3" height="3.3" rx="0.53" />
        <rect x="1.96" y="10.86" width="3.3" height="3.3" rx="0.53" />
        <rect x="5.71" y="10.86" width="3.3" height="3.3" rx="0.53" />
        <rect x="9.46" y="10.86" width="3.3" height="3.3" rx="0.53" />
      </g>
      <rect x="10.74" y="2.09" width="3.3" height="3.3" rx="0.53" fill="currentColor" transform="rotate(9 12.39 3.74)" />
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
        <MarketGlyph />
      </button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={t('fabModalTitle')}
        >
          <div className={css.fabBody}>
            <MarketSection t={t} {...market} />
          </div>
        </Modal>
      )}
    </>
  )
}
