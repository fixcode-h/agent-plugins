import { t } from '../../host.ts'
import { ms } from './GtStepDetail.tsx'
import { condSay, skipPayload } from './gt-skip.ts'

/**
 * 结果里和「已达成就跳过」有关的几行（GameTest 1.7.0，设计稿 5.3）：跳过了看到的是什么、等了多久、连带几步；
 * 被连带跳过的写随第几步；照常做了的写当时为什么没跳（payload.skipCheck），做完核对的实际值（payload.verified）
 */
export function GtSkipResult({ payload }: { payload?: Record<string, unknown> }) {
  const skip = skipPayload(payload)
  const checked = typeof payload?.skipCheck === 'string' ? payload.skipCheck : undefined
  const verified = typeof payload?.verified === 'string' ? payload.verified : undefined
  if (!skip && !checked && !verified) return null
  return (
    <>
      {skip && typeof skip.with === 'number' && (
        <p className="ue:text-subtle">{t('第 {n} 步已达成，这一步跟着跳过', { n: skip.with + 1 })}</p>
      )}
      {skip && skip.with === undefined && (
        <p className="ue:text-subtle">
          {t('条件：{c}；看到的：{a}', {
            c: skip.say || (skip.cond ? condSay(skip.cond) : '?'),
            a: skip.actual || '?',
          })}
          {skip.waitedMs !== undefined && ` · ${t('确认用了 {s}', { s: ms(skip.waitedMs) })}`}
          {skip.also ? ` · ${t('连带跳过后面 {n} 步', { n: skip.also })}` : ''}
        </p>
      )}
      {checked && <p className="ue:text-subtle">{t('回放时没达成，照常做了（{s}）', { s: checked })}</p>}
      {verified && <p className="ue:text-subtle">{t('做完核对：已达成（{s}）', { s: verified })}</p>}
    </>
  )
}
