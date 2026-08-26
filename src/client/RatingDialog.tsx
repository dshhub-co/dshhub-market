/**
 * 评分对话框（插件端入口）：解锁卡片 / 已安装行的「评分」触发。5 星 + 可选
 * 评论，匿名（买家无需登录）。经本地代理 POST /dsh-market/ratings → 平台
 * /api/ratings → submit_rating RPC（user_id 可空，匿名各算一票）。服务端
 * 限速 rating:ip 20/时 + rating:plugin:{id}:{ip} 3/天，429 走本地文案。
 */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './market-data.ts'
import css from './Market.module.css'

const STARS = [1, 2, 3, 4, 5]

export function RatingDialog({ pluginId, name, open, onClose, t }: {
  pluginId: string
  name: string
  open: boolean
  onClose: () => void
  t: Translate
}) {
  const [score, setScore] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    if (score < 1) {
      setMsg({ ok: false, text: t('ratePickScore') })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/dsh-market/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluginId,
          score,
          comment: comment.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        if (res.status === 429) throw new Error(t('rateTooFast'))
        throw new Error(data.error ?? t('rateFail'))
      }
      setMsg({ ok: true, text: t('rateOk') })
      setScore(0)
      setComment('')
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
    setBusy(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('rateTitle')}
      description={`${name} · ${pluginId}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>{busy ? t('rateSubmitting') : t('rateSubmit')}</Button>
        </>
      )}
    >
      <div className={css.fbField}>
        <label>{t('rateScoreLabel')}</label>
        <div className={css.rateStars}>
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} / 5`}
              className={n <= score ? `${css.rateStar} ${css.rateStarOn}` : css.rateStar}
              onClick={() => setScore(n)}
            >
              {n <= score ? '★' : '☆'}
            </button>
          ))}
          {score > 0 && <span className={css.rateNote}>{t('rateScoreValue').replace('{0}', String(score))}</span>}
        </div>
      </div>
      <div className={css.fbField}>
        <label>{t('rateCommentLabel')}</label>
        <textarea
          className={css.fbTextarea}
          rows={3}
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('rateCommentPh')}
        />
      </div>
      {msg !== null && <p className={msg.ok ? css.fbOk : css.fbError}>{msg.text}</p>}
    </Modal>
  )
}
