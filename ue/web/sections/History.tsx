import { Bot, Undo2, User } from 'lucide-react'
import { useState } from 'react'
import type { HistoryItem } from '../../server/types.ts'
import { pget, ppost, show, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Confirm, ErrorText, LinkBtn, PageHead, kindLabel } from '../ui.tsx'

type Item = HistoryItem & { live?: boolean }

/** 操作类型的叫法：记录里存的是桥接的 op 名，给人看的换成中文 */
const OPS: Record<string, () => string> = {
  set: () => t('改属性'),
  call: () => t('调函数'),
  console: () => t('控制台'),
  'cvar.set': () => t('改控制台变量'),
  'gm.run': () => 'GM',
  'datatable.set': () => t('改数据表'),
  'datatable.rows': () => t('增删数据表行'),
  'asset.save': () => t('保存资源'),
  'asset.revert': () => t('放弃资源改动'),
  'lua.set': () => t('改 Lua 字段'),
  'lua.exec': () => t('执行 Lua'),
  pie: () => 'PIE',
  'log.clear': () => t('清空日志'),
  livecoding: () => 'Live Coding',
}
const opLabel = (op: string) => OPS[op]?.() ?? op

/** 摘要里的长对象路径只留最后一段（…:PersistentLevel.BP_Hero_C_1 → BP_Hero_C_1），完整的放悬停提示 */
const shorten = (s: string) =>
  s.replace(/\/[\w/.-]+[.:][\w.:-]+/g, (p) => (p.includes(':') ? p.split(/[.:]/).pop() || p : p))

const day = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return t('今天')
  if (d.toDateString() === y.toDateString()) return t('昨天')
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', weekday: 'short' })
}
const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * 操作记录（界面优化第 14 条）：按天分组的两行列表（谁、什么操作、目标 / 摘要、改前改后），
 * 按谁、操作类型、只看能撤回筛；还在生效的运行时修改有横幅一键全部撤回，失败原因直接写在行里
 */
export function History() {
  const { project, badges, reloadBadges } = useUe()
  const { ui, cn, hooks, toast } = h()
  const nav = hooks.useNav()
  const { busy, run } = useAction()
  const [who, setWho] = useState('')
  const [op, setOp] = useState('')
  const [onlyLive, setOnlyLive] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  // 撤回没成功的条目和原因：直接写在那一行下面（撤回失败不进记录文件，只在这次页面里显示）
  const [undoErr, setUndoErr] = useState<Record<string, string>>({})
  const list = useLoad(() => pget<{ items: Item[] }>(project.id, 'history'), [project.id], 5000)
  const all = list.data?.items ?? []
  const ops = [...new Set(all.map((i) => i.op))]
  const items = all.filter(
    (i) =>
      (!who || (who === 'user' ? i.actor.kind === 'user' : i.actor.kind === 'agent')) &&
      (!op || i.op === op) &&
      (!onlyLive || i.live),
  )
  const liveN = all.filter((i) => i.live).length
  const groups: [string, Item[]][] = []
  for (const it of items) {
    const d = day(it.at)
    const g = groups[groups.length - 1]
    if (g && g[0] === d) g[1].push(it)
    else groups.push([d, [it]])
  }

  const refresh = () => {
    void list.reload()
    reloadBadges()
  }
  const undoOne = (id: string) =>
    run(id, async () => {
      try {
        await ppost(project.id, 'undo', { id })
        setUndoErr(({ [id]: _, ...rest }) => rest)
      } catch (e) {
        setUndoErr((m) => ({ ...m, [id]: (e as Error).message }))
        throw e
      } finally {
        refresh()
      }
    })
  const undoAll = () =>
    run('undo-all', async () => {
      setConfirmAll(false)
      const r = await ppost<{ done: number; failed: { id: string; error: string }[] }>(project.id, 'undo/all')
      setUndoErr(Object.fromEntries(r.failed.map((f) => [f.id, f.error])))
      if (r.failed.length)
        toast.error(t('撤回了 {n} 处，{m} 处没撤回，原因写在那几行下面', { n: r.done, m: r.failed.length }))
      else toast.success(t('撤回了 {n} 处修改', { n: r.done }))
      refresh()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('操作记录')} desc={t('你和 Agent 做过的修改；运行时修改可以撤回，保留天数在插件参数里改')}>
        <ui.Button size="sm" variant="ghost" onClick={() => setClearing(true)}>
          {t('清空记录')}
        </ui.Button>
      </PageHead>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
          <ui.Segmented
            size="sm"
            label={t('谁')}
            value={who}
            onChange={setWho}
            options={[
              { id: '', label: t('全部') },
              { id: 'user', label: t('你') },
              { id: 'agent', label: 'Agent' },
            ]}
          />
          <ui.Select
            size="sm"
            className="ue:w-40"
            value={op}
            onChange={(e: { target: { value: string } }) => setOp(e.target.value)}
            options={[{ value: '', label: t('所有操作') }, ...ops.map((o) => ({ value: o, label: opLabel(o) }))]}
          />
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-muted">
            <input type="checkbox" checked={onlyLive} onChange={(e) => setOnlyLive(e.target.checked)} />
            {t('只看能撤回的')}
          </label>
        </div>
        {(liveN > 0 || !!badges?.undoable) && (
          <div className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-warning/30 ue:bg-warning/10 ue:px-4 ue:py-2 ue:text-body ue:text-fg">
            <Undo2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-warning" />
            <span className="ue:min-w-0 ue:flex-1">
              {t('{n} 处运行时修改还在生效（进程和世界还在）', { n: liveN || badges?.undoable || 0 })}
            </span>
            <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setConfirmAll(true)}>
              {t('全部撤回')}
            </ui.Button>
          </div>
        )}
        <ErrorText>{list.error}</ErrorText>
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
          {groups.map(([d, its]) => (
            <section key={d}>
              <h3 className="ue:sticky ue:top-0 ue:z-10 ue:border-b ue:border-line ue:bg-hover ue:px-4 ue:py-1.5 ue:text-footnote ue:font-medium ue:text-subtle">
                {d}
              </h3>
              <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:border-b ue:border-line ue:bg-card">
                {its.map((it) => (
                  <li key={it.id} className="ue:flex ue:items-start ue:gap-3 ue:px-4 ue:py-2.5">
                    <span className="ue:w-11 ue:shrink-0 ue:pt-px ue:font-mono ue:text-footnote ue:text-subtle">
                      {hm(it.at)}
                    </span>
                    <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-0.5">
                      <div className="ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-0.5 ue:text-footnote">
                        <span className="ue:font-medium ue:text-fg">{opLabel(it.op)}</span>
                        <span className="ue:flex ue:items-center ue:gap-1 ue:text-muted">
                          {it.actor.kind === 'user' ? (
                            <>
                              <User className="ue:h-3 ue:w-3" /> {t('你')}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:text-accent-text ue:hover:underline"
                              onClick={() =>
                                it.actor.kind === 'agent' &&
                                nav.go({ page: 'projects', id: project.id, sub: it.actor.taskId })
                              }
                            >
                              <Bot className="ue:h-3 ue:w-3" /> {it.actor.agent || t('对话')}
                            </button>
                          )}
                        </span>
                        {it.instanceKind && (
                          <span className="ue:text-subtle">
                            {kindLabel(it.instanceKind)}
                            {it.world ? ` · ${it.world}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={it.summary}>
                        {shorten(it.summary)}
                      </div>
                      {it.prev !== undefined && (
                        <div className="ue:truncate ue:font-mono ue:text-caption ue:text-muted">
                          <s>{show(it.prev)}</s> → {show(it.value)}
                        </div>
                      )}
                      {it.error && <div className="ue:text-footnote ue:break-all ue:text-danger">{it.error}</div>}
                      {undoErr[it.id] && (
                        <div className="ue:text-footnote ue:break-all ue:text-danger">
                          {t('撤回失败：{e}', { e: undoErr[it.id] })}
                        </div>
                      )}
                    </div>
                    <div className="ue:flex ue:shrink-0 ue:flex-col ue:items-end ue:gap-1">
                      {it.undo && !it.undone && it.ok ? (
                        <LinkBtn disabled={!!busy} onClick={() => void undoOne(it.id)}>
                          <Undo2 className="ue:h-3 ue:w-3" /> {t('撤回修改')}
                        </LinkBtn>
                      ) : (
                        <Badge tone={it.ok ? (it.undone ? 'muted' : 'ok') : 'danger'}>
                          {it.undone ? t('已撤回') : it.ok ? t('成功') : t('失败')}
                        </Badge>
                      )}
                      {it.ok && !it.undone && !it.undo && it.noUndo && (
                        <span className={cn('ue:text-caption ue:text-subtle')} title={it.noUndo}>
                          {t('不能撤回')}
                        </span>
                      )}
                      {it.undo && !it.undone && it.ok && it.live === false && (
                        <span className="ue:text-caption ue:text-subtle" title={t('改它的进程或世界已经不在了')}>
                          {t('已失效')}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {list.data && !items.length && (
            <p className="ue:p-8 ue:text-center ue:text-footnote ue:text-subtle">{t('没有记录')}</p>
          )}
        </div>
      </div>
      <Confirm
        open={confirmAll}
        title={t('全部撤回')}
        okText={t('全部撤回')}
        danger
        onOk={() => void undoAll()}
        onCancel={() => setConfirmAll(false)}
      >
        {t(
          '把还在生效的 {n} 处运行时修改按从新到旧撤回到改之前的值。资源的修改不在这里，用「资源」页的「放弃改动」。',
          {
            n: liveN || badges?.undoable || 0,
          },
        )}
      </Confirm>
      <Confirm
        open={clearing}
        title={t('清空操作记录？')}
        okText={t('清空')}
        danger
        onCancel={() => setClearing(false)}
        onOk={() =>
          void run('clear', async () => {
            setClearing(false)
            await ppost(project.id, 'history/clear')
            refresh()
          })
        }
      >
        {t('清空后这些修改就不能再从这里撤回了。')}
      </Confirm>
    </div>
  )
}
