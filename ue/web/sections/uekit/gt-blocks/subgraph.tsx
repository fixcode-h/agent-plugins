import { useEffect, useState } from 'react'
import { parseScript, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { op, ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { debugSession } from '../gt-debug/session.ts'
import { Row, TextField } from './parts.tsx'
import { asSubgraph, noJson } from './subgraph-swap.ts'

/**
 * 子图的检查器：段（group）和调用脚本（call）在界面上是同一种「子图」节点（用户 2026-11-19：合成一个，
 * 选了脚本就跑那个脚本，没选就跑图里自己编辑的）。数据照旧是两种动作，GameTest 运行时不用改：
 * 选脚本 = 换成 call，清掉脚本 = 换回空的 group；名字、说明、失败了怎么办这些公共字段跟着走。
 * 脚本从脚本库下拉搜索选，参数按被调脚本声明的 params 出表单，不再手填 JSON
 */

/** 不挂脚本时下拉框里的值（下拉框不认空字符串） */
const INLINE = '#inline'

interface ListItem {
  name: string
  relativePath: string
  parseError?: string
}

// 脚本列表、被调脚本的参数：每个检查器都要，按项目缓存一份（脚本库改了以后 30 秒内会旧，下拉框打开时就够用）
const lists = new Map<string, { at: number; p: Promise<ListItem[]> }>()
function scriptList(project: string): Promise<ListItem[]> {
  const hit = lists.get(project)
  if (hit && Date.now() - hit.at < 30_000) return hit.p
  const p = op<{ scenarios: ListItem[] }>(project, 'gt.scenarios', { limit: 1000, disk: true })
    .then((r) => (r.scenarios ?? []).filter((s) => !s.parseError))
    .catch(() => [])
  lists.set(project, { at: Date.now(), p })
  return p
}

type Params = NonNullable<GtScript['params']>
/** 读不到（文件没了、格式坏了）返回 null：参数退回手填 */
async function paramsOf(project: string, root: string, script: string): Promise<Params | null> {
  try {
    const r = await ppost<{ text: string }>(project, 'ext/gt/file', { root, path: `${script}.json`, action: 'raw' })
    const p = parseScript(r.text)
    return 'error' in p ? null : (p.doc.params ?? {})
  } catch {
    return null
  }
}

function useScripts() {
  const s = debugSession()
  const [list, setList] = useState<ListItem[]>([])
  useEffect(() => {
    if (!s) return
    let live = true
    void scriptList(s.project).then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [s?.project])
  return list
}

function useParams(script: string) {
  const s = debugSession()
  // undefined 是还在读
  const [params, setParams] = useState<Params | null>()
  useEffect(() => {
    // 没有编辑会话（控件样式里的示例）读不了文件：参数退回手填
    setParams(s ? undefined : null)
    if (!s || !script) return
    let live = true
    void paramsOf(s.project, s.root, script).then((p) => live && setParams(p))
    return () => {
      live = false
    }
  }, [s?.project, s?.root, script])
  return params
}

export function SubgraphInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const list = useScripts()
  const script = step.action === 'call' ? noJson(String(step.script ?? '')) : ''
  const params = useParams(script)
  const self = noJson(debugSession()?.scenario ?? '')
  const inside = step.action === 'group' && Array.isArray(step.do) ? step.do.length : 0
  const options = [
    { value: INLINE, label: t('不挂，图里自己编辑') },
    ...list
      .map((s) => noJson(s.relativePath))
      .filter((p) => p !== self)
      .map((p) => ({ value: p, label: p })),
  ]
  // 填的脚本不在库里（手写的、被删了）也照样显示出来
  if (script && !options.some((o) => o.value === script)) options.push({ value: script, label: script })
  const given = (step.with && typeof step.with === 'object' ? step.with : {}) as Record<string, unknown>
  // 默认值写进占位：没填就用它
  const args = Object.entries(params ?? {}).map(([name, p]) => ({
    name,
    type: p.default === undefined ? (p.type ?? '') : t('默认 {v}', { v: JSON.stringify(p.default) }),
    note: p.note,
  }))
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('名字')}>
        <TextField step={step} k="name" onChange={onChange} placeholder={script || t('打开福利')} />
      </Row>
      <Row label={t('脚本')} hint={t('选了就跑那个脚本（引用，改的是原脚本）；不挂就跑这个子图里自己编辑的')}>
        <ui.Select
          size="sm"
          search
          className="ue:w-full"
          value={script || INLINE}
          options={options}
          onChange={(e: { target: { value: string } }) => {
            const v = e.target.value === INLINE ? '' : e.target.value
            if (v !== script) onChange(asSubgraph(step, v))
          }}
        />
        {!script && (
          <p className="ue:mt-1 ue:text-footnote ue:text-subtle">
            {inside
              ? t('里面 {n} 步，双击画布上的节点进去编辑；选了脚本会换掉它们（可以撤销）', { n: inside })
              : t('空的：双击画布上的节点进去放节点、连线')}
          </p>
        )}
      </Row>
      {script && (
        <>
          <Row label={t('参数')}>
            {params === undefined ? (
              <span className="ue:text-footnote ue:text-subtle">{t('读取中…')}</span>
            ) : params === null || args.length || Object.keys(given).length ? (
              <ArgsEdit
                api={args.length ? { args } : undefined}
                value={given}
                onChange={(w) => onChange({ ...step, with: w })}
              />
            ) : (
              <span className="ue:text-footnote ue:text-subtle">{t('这个脚本没有参数')}</span>
            )}
          </Row>
          <Row label={t('返回值存到')}>
            <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
          </Row>
        </>
      )}
    </div>
  )
}
