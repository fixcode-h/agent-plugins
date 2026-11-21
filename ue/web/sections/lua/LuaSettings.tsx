import { useEffect, useState } from 'react'
import type { LuaSettings as Settings } from '../../../server/lua/settings.ts'
import { op, pget, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card, ErrorText } from '../../ui.tsx'
import { useLuaOp } from './lua-data.ts'

/** 多值的项在输入框里一行一个（逗号也认） */
const toText = (v: string[]) => v.join('\n')
const fromText = (s: string) =>
  s
    .split(/[\n,，]/)
    .map((x) => x.trim())
    .filter(Boolean)

interface TryRes {
  items?: { module: string; count: number }[]
  total?: number
  visited?: number
  truncated?: boolean
  ms?: number
  rootsMissing?: string[]
}

/**
 * 「权限与设置」里的「Lua」（用户 2026-11-21：Lua 相关的设置都放 UE 插件设置里）：纯 Lua 实例怎么认（类名字段、起点变量、显示名字段）、
 * UnLua 实例表的对象字段名、走堆上限。存项目文档根 AgentPanel/UE/lua.json（团队共用），连上 UE 时下发给 UELink（lua/settings.ts）。
 * 「试一下」按还没保存的填法找一遍，看认出了哪些 Lua 类、各几个实例
 */
export function LuaSettings() {
  const { project, state, target } = useUe()
  const { ui, toast } = h()
  const { busy, run } = useAction()
  const res = useLoad(() => pget<{ settings: Settings; file: string }>(project.id, 'lua/settings'), [project.id])
  const [form, setForm] = useState<Record<keyof Settings, string> | undefined>()
  const [tried, setTried] = useState<TryRes | undefined>()
  const [tryErr, setTryErr] = useState('')
  const canTry = useLuaOp('lua.instances')
  const saved = res.data?.settings
  useEffect(() => {
    if (saved)
      setForm({
        classFields: toText(saved.classFields),
        roots: toText(saved.roots),
        nameFields: toText(saved.nameFields),
        objectKey: saved.objectKey,
        maxVisit: saved.maxVisit ? String(saved.maxVisit) : '',
      })
  }, [saved])
  if (!state?.unlua || !form) return null

  const value = () => ({
    classFields: fromText(form.classFields),
    roots: fromText(form.roots),
    nameFields: fromText(form.nameFields),
    objectKey: form.objectKey.trim(),
    maxVisit: Number(form.maxVisit) || 0,
  })
  const field = (k: keyof Settings) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }),
  })
  const save = () =>
    run('lua-settings', async () => {
      await ppost(project.id, 'lua/settings', { settings: value() })
      res.reload()
      toast.success(t('已保存'))
    })
  const tryIt = () =>
    run('lua-try', async () => {
      setTryErr('')
      setTried(undefined)
      const v = value()
      try {
        setTried(
          await op<TryRes>(
            project.id,
            'lua.instances',
            {
              classFields: v.classFields,
              roots: v.roots,
              nameFields: v.nameFields,
              ...(v.objectKey ? { objectKey: v.objectKey } : {}),
              ...(v.maxVisit ? { maxVisit: v.maxVisit } : {}),
              limit: 30,
            },
            target,
            60000,
          ),
        )
      } catch (e) {
        setTryErr((e as Error).message)
      }
    })

  return (
    <Card title={t('Lua')} aside={res.data?.file ?? t('项目文档根，团队共用')}>
      <form
        className="ue:grid ue:gap-4 ue:p-4 ue:sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="ue:text-body ue:text-subtle ue:sm:col-span-2">
          {t(
            '纯 Lua 实例是 Lua 框架自己 new 出来、不绑 UObject 的表（比如子模块）。都留空时自动找：从 _G 走整个 Lua 堆，元表链上有这个 Lua 类就算它的实例。选对象、Lua 页对象树、GM 对象调用都按这里找',
          )}
        </p>
        <ui.Field
          label={t('类名字段')}
          hint={t('实例上写着自己类（模块路径）的字段，一行一个；值等于模块名就算这个类的实例')}
        >
          <ui.Textarea className="ue:font-mono" rows={2} placeholder="SubModulePath" {...field('classFields')} />
        </ui.Field>
        <ui.Field label={t('显示名字段')} hint={t('列表里用它当名字，一行一个，取第一个有值的')}>
          <ui.Textarea className="ue:font-mono" rows={2} placeholder="SubModuleName" {...field('nameFields')} />
        </ui.Field>
        <ui.Field
          label={t('从哪些变量开始找')}
          hint={t('一行一个，例如 _G.GameApp.Modules；填了只从这些地方往下找，更快，留空走整个 Lua 堆')}
          className="ue:sm:col-span-2"
        >
          <ui.Textarea className="ue:font-mono" rows={2} placeholder={t('留空：整个 Lua 堆')} {...field('roots')} />
        </ui.Field>
        <ui.Field
          label={t('UnLua 实例表的对象字段')}
          hint={t('实例表里放 UObject 的字段名，二次开发的 UnLua 可能改过')}
        >
          <ui.Input className="ue:font-mono" placeholder="Object" {...field('objectKey')} />
        </ui.Field>
        <ui.Field label={t('最多走多少个表')} hint={t('走整个堆时的上限，大项目走一遍几百毫秒')}>
          <ui.Input className="ue:font-mono" inputMode="numeric" placeholder="200000" {...field('maxVisit')} />
        </ui.Field>
        <p className="ue:text-footnote ue:text-subtle ue:sm:col-span-2">
          {t('脚本根用下面「Lua 编译」里的 Lua 脚本目录，两处共用一个')}
        </p>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:sm:col-span-2">
          <ui.Button size="sm" type="submit" disabled={!!busy}>
            {t('保存')}
          </ui.Button>
          <ui.Button
            size="sm"
            variant="secondary"
            disabled={!!busy || !canTry}
            title={canTry ? undefined : t('要 UELink 2.20.0 以上，并且游戏开着')}
            onClick={() => void tryIt()}
          >
            {busy === 'lua-try' ? t('找…') : t('试一下')}
          </ui.Button>
          {!canTry && (
            <span className="ue:text-footnote ue:text-subtle">{t('要 UELink 2.20.0 以上，并且游戏开着')}</span>
          )}
        </div>
        {tryErr && (
          <div className="ue:sm:col-span-2">
            <ErrorText>{tryErr}</ErrorText>
          </div>
        )}
        {tried && <TryResult r={tried} />}
      </form>
    </Card>
  )
}

/** 试一下的结果：认出的 Lua 类和实例数（多的在前） */
function TryResult({ r }: { r: TryRes }) {
  const items = r.items ?? []
  return (
    <div className="ue:rounded-md ue:border ue:border-line ue:bg-panel ue:p-3 ue:text-body ue:sm:col-span-2">
      <p className="ue:text-footnote ue:text-subtle">
        {t('找到 {n} 个纯 Lua 实例，属于 {c} 个 Lua 类；看了 {v} 个表，用了 {ms} 毫秒', {
          n: r.total ?? 0,
          c: items.length,
          v: r.visited ?? 0,
          ms: r.ms ?? 0,
        })}
        {r.truncated ? ` · ${t('到上限没走完，可以填起点变量或调大上限')}` : ''}
      </p>
      {!!r.rootsMissing?.length && (
        <p className="ue:mt-1 ue:text-footnote ue:text-warning">
          {t('这些起点变量取不到：{list}', { list: r.rootsMissing.join('、') })}
        </p>
      )}
      {items.length > 0 && (
        <ul className="ue:mt-2 ue:grid ue:gap-1 ue:font-mono ue:text-footnote">
          {items.map((it) => (
            <li key={it.module} className="ue:flex ue:gap-3">
              <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-fg" title={it.module}>
                {it.module}
              </span>
              <span className="ue:text-muted">{it.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
