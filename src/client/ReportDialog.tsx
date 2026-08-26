/**
 * 举报对话框（插件端入口）：解锁卡片 / 已安装行的「举报」触发。
 * 经本地代理 POST /dsh-market/report → 平台 /api/reports（匿名通道，服务端
 * 限速 report:ip 5/时 + report:plugin 10/时 + RPC 校验）。状态码透传：
 * 429 走本地限速文案，其余错误优先展示平台返回的中文提示。
 */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './market-data.ts'
import css from './Market.module.css'

const CATEGORIES = [
  { value: 'infringement', key: 'reportCatInfringement' },
  { value: 'malware', key: 'reportCatMalware' },
  { value: 'misleading', key: 'reportCatMisleading' },
  { value: 'porn', key: 'reportCatPorn' },
  { value: 'fraud', key: 'reportCatFraud' },
  { value: 'other', key: 'reportCatOther' },
] as const

export function ReportDialog({ pluginId, name, open, onClose, t }: {
  pluginId: string
  name: string
  open: boolean
  onClose: () => void
  t: Translate
}) {
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    if (category === '') {
      setMsg({ ok: false, text: t('reportPickCategory') })
      return
    }
    if (description.trim().length < 10) {
      setMsg({ ok: false, text: t('reportTooShort') })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/dsh-market/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluginId,
          category,
          description: description.trim(),
          contact: contact.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        if (res.status === 429) throw new Error(t('reportRateLimited'))
        throw new Error(data.error ?? t('reportFail'))
      }
      setMsg({ ok: true, text: t('reportOk') })
      setDescription('')
      setContact('')
      setCategory('')
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
    setBusy(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('reportTitle')}
      description={`${name} · ${pluginId}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>{busy ? t('reportSubmitting') : t('reportSubmit')}</Button>
        </>
      )}
    >
      <div className={css.fbField}>
        <label>{t('reportCategoryLabel')}</label>
        <select className={css.fbSelect} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('reportPick')}</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{t(c.key)}</option>
          ))}
        </select>
      </div>
      <div className={css.fbField}>
        <label>{t('reportDescLabel')}</label>
        <textarea
          className={css.fbTextarea}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('reportDescPh')}
        />
      </div>
      <div className={css.fbField}>
        <label>{t('reportContactLabel')}</label>
        <input
          className={css.fbInput}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder={t('reportContactPh')}
        />
      </div>
      {msg !== null && <p className={msg.ok ? css.fbOk : css.fbError}>{msg.text}</p>}
    </Modal>
  )
}
