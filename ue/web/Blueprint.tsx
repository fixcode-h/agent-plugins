import { ExternalLink, Hammer } from 'lucide-react'
import { useState } from 'react'
import { op, show, useAction, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Badge, ErrorText, Note, Term, type Tone } from './ui.tsx'

interface Param {
  name: string
  type: string
}
interface GraphBrief {
  name: string
  kind: string
  nodes: number
  inputs?: Param[]
  outputs?: Param[]
  pure?: boolean
  events?: { name: string; node: string; custom: boolean }[]
}
interface Component {
  name: string
  class: string
  template?: string
  children?: Component[]
}
interface NodeIssue {
  graph: string
  node: string
  title: string
  severity: string
  text: string
}
interface Compile {
  status: string
  errors?: number
  warnings?: number
  messages?: { severity: string; text: string }[]
  nodes: NodeIssue[]
  affected?: { path: string; why: string; status: string }[]
}
interface Outline {
  path: string
  name: string
  parent: string
  status: string
  dirty: boolean
  interfaces: string[]
  variables: {
    name: string
    type: string
    category?: string
    replication?: string
    instanceEditable: boolean
    exposeOnSpawn?: boolean
    default?: unknown
  }[]
  dispatchers: Param[]
  components: Component[]
  graphs: GraphBrief[]
  timelines: string[]
  compile: Compile
}
interface Pin {
  name: string
  dir: string
  type: string
  default?: string
  to?: string[]
}
interface NodeDetail {
  id: string
  kind: string
  title: string
  member?: string
  comment?: string
  error?: string
  class?: string
  pins: Pin[]
}

const STATUS: Record<string, { tone: Tone; label: () => string }> = {
  ok: { tone: 'ok', label: () => t('编译通过') },
  warnings: { tone: 'warn', label: () => t('有警告') },
  error: { tone: 'danger', label: () => t('编译出错') },
  dirty: { tone: 'warn', label: () => t('改了没编译') },
}
const GRAPH_KIND: Record<string, () => string> = {
  event: () => t('事件图'),
  function: () => t('函数'),
  macro: () => t('宏'),
  interface: () => t('接口函数'),
  delegate: () => t('分发器'),
  sub: () => t('子图'),
}
const shortClass = (p: string) => p.split('.').pop() ?? p

/**
 * 蓝图的只读视图：左边是大纲（各张图、变量、组件树），右边是选中那张图的伪代码，点行尾的节点 id 看这个节点的引脚和连线。
 * 和 Agent 的 ue_blueprint 读的是同一份数据；修改交给 Agent（操作列表）或在 UE 编辑器里做，这里只提供「编译」。
 */
export function BlueprintView({
  path,
  onOpen,
  onChanged,
}: {
  path: string
  onOpen: (path: string) => void
  onChanged: () => void
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const outline = useLoad(() => op<Outline>(project.id, 'bp.outline', { path }, undefined, 120000), [path])
  const o = outline.data
  const [picked, setPicked] = useState('')
  const [format, setFormat] = useState<'pseudo' | 'json'>('pseudo')
  const [node, setNode] = useState('')
  const [compiled, setCompiled] = useState<Compile>()
  const graph = picked || o?.graphs[0]?.name || ''
  const body = useLoad(
    () =>
      graph
        ? op<{ pseudo?: string; more?: boolean; nodes?: NodeDetail[]; total: number; next?: number }>(
            project.id,
            'bp.graph',
            { path, graph, format, limit: 200 },
            undefined,
            120000,
          )
        : Promise.resolve(undefined),
    [path, graph, format],
  )
  const detail = useLoad(
    () =>
      node
        ? op<{ graph: string; node: NodeDetail }>(project.id, 'bp.graph', { path, node }, undefined, 60000)
        : Promise.resolve(undefined),
    [path, node],
  )
  const compile = compiled ?? o?.compile
  const status = STATUS[compile?.status ?? o?.status ?? '']

  const doCompile = () =>
    run('compile', async () => {
      const r = await op<{ compile: Compile }>(project.id, 'bp.compile', { path }, undefined, 300000)
      setCompiled(r.compile)
      void outline.reload()
      onChanged()
    })
  const pick = (name: string) => {
    setPicked(name)
    setNode('')
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
        <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">{o?.name ?? shortClass(path)}</span>
        {o && <Badge title={o.parent}>{t('父类 {name}', { name: shortClass(o.parent) })}</Badge>}
        {status && <Badge tone={status.tone}>{status.label()}</Badge>}
        {o?.dirty && <Badge tone="warn">{t('未保存')}</Badge>}
        <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          <ui.Segmented
            size="sm"
            label={t('伪代码 / 节点')}
            value={format}
            onChange={setFormat}
            options={[
              { id: 'pseudo', label: t('伪代码') },
              { id: 'json', label: t('节点') },
            ]}
          />
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void doCompile()}>
            <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')}
          </ui.Button>
          <ui.IconButton
            icon={ExternalLink}
            label={t('在编辑器里打开')}
            size="sm"
            onClick={() => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))}
          />
        </div>
      </header>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:px-4 ue:pt-3 ue:empty:hidden">
        <ErrorText>{outline.error}</ErrorText>
        {!!compile?.nodes.length && (
          <Note tone="warn">
            <ul className="ue:flex ue:flex-col ue:gap-1">
              {compile.nodes.slice(0, 20).map((n) => (
                <li key={n.graph + n.node}>
                  <button
                    type="button"
                    className="ue:cursor-pointer ue:font-mono ue:text-accent-text ue:hover:underline"
                    onClick={() => {
                      setPicked(n.graph)
                      setNode(n.node)
                    }}
                  >
                    {n.graph} #{n.node}
                  </button>{' '}
                  <span className={n.severity === 'error' ? 'ue:text-danger' : undefined}>{n.text || n.title}</span>
                </li>
              ))}
            </ul>
          </Note>
        )}
        {compiled?.affected?.some((x) => x.status === 'error') && (
          <Note tone="warn">
            {t('受影响的蓝图里有编译出错的：')}
            {compiled.affected
              .filter((x) => x.status === 'error')
              .map((x) => shortClass(x.path))
              .join('、')}
          </Note>
        )}
      </div>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-3 ue:p-4 ue:lg:flex-row">
        <nav className="ue:flex ue:max-h-56 ue:shrink-0 ue:flex-col ue:gap-3 ue:overflow-auto ue:text-footnote ue:lg:max-h-none ue:lg:w-60">
          <Group title={t('图')}>
            {(o?.graphs ?? []).map((g) => (
              <li key={g.name}>
                <button
                  type="button"
                  onClick={() => pick(g.name)}
                  title={signature(g)}
                  className={cn(
                    'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:py-1 ue:text-left ue:hover:bg-hover',
                    graph === g.name && 'ue:bg-sel',
                  )}
                >
                  <span className="ue:truncate ue:font-mono ue:text-fg">{g.name}</span>
                  <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">
                    {(GRAPH_KIND[g.kind] ?? GRAPH_KIND.sub)()} · {g.nodes}
                  </span>
                </button>
              </li>
            ))}
          </Group>
          {!!o?.variables.length && (
            <Group title={t('变量')}>
              {o.variables.map((v) => (
                <li key={v.name} className="ue:px-2 ue:py-1" title={v.category}>
                  <div className="ue:flex ue:items-center ue:gap-2">
                    <span className="ue:truncate ue:font-mono ue:text-fg">{v.name}</span>
                    {v.replication && <Badge tone="accent">{t('同步')}</Badge>}
                    <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{v.type}</span>
                  </div>
                  {v.default !== undefined && show(v.default) !== '' && (
                    <div className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">= {show(v.default)}</div>
                  )}
                </li>
              ))}
            </Group>
          )}
          {!!o?.components.length && (
            <Group title={t('组件')}>
              {o.components.map((c) => (
                <ComponentRow key={c.name} c={c} depth={0} onOpen={onOpen} />
              ))}
            </Group>
          )}
          {!!o?.interfaces.length && (
            <Group title={t('接口')}>
              {o.interfaces.map((i) => (
                <li key={i} className="ue:truncate ue:px-2 ue:py-1 ue:font-mono ue:text-fg" title={i}>
                  {shortClass(i)}
                </li>
              ))}
            </Group>
          )}
        </nav>
        <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-3">
          <ErrorText>{body.error}</ErrorText>
          {body.data?.pseudo !== undefined && (
            <Term className="ue:min-h-40 ue:flex-1">
              {body.data.pseudo.split('\n').map((line, i) => (
                <PseudoLine key={i} line={line} active={node} onNode={setNode} />
              ))}
              {body.data.more && (
                <div className="ue:mt-2 ue:text-term-dim">{t('太长，后面的没有显示；切到「节点」分页看')}</div>
              )}
            </Term>
          )}
          {body.data?.nodes && (
            <ul className="ue:min-h-40 ue:flex-1 ue:overflow-auto ue:rounded-xl ue:border ue:border-line ue:p-1.5 ue:text-footnote">
              {body.data.nodes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setNode(n.id)}
                    className={cn(
                      'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:py-1 ue:text-left ue:hover:bg-hover',
                      node === n.id && 'ue:bg-sel',
                    )}
                  >
                    <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">#{n.id}</span>
                    <span className="ue:truncate ue:text-fg">{n.title}</span>
                    {n.error && <Badge tone="danger">{t('有错误')}</Badge>}
                    <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{n.kind}</span>
                  </button>
                </li>
              ))}
              {body.data.next !== undefined && (
                <li className="ue:px-2 ue:py-1 ue:text-subtle">
                  {t('共 {n} 个，只列前 {m} 个', { n: body.data.total, m: body.data.nodes.length })}
                </li>
              )}
            </ul>
          )}
          {node && (
            <section className="ue:max-h-64 ue:shrink-0 ue:overflow-auto ue:rounded-xl ue:border ue:border-line ue:text-footnote">
              <header className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2">
                <span className="ue:font-mono ue:text-subtle">#{node}</span>
                <span className="ue:font-medium ue:text-fg">{detail.data?.node.title}</span>
                {detail.data?.node.member && <Badge>{detail.data.node.member}</Badge>}
                <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={() => setNode('')}>
                  {t('关闭')}
                </ui.Button>
              </header>
              <div className="ue:flex ue:flex-col ue:gap-2 ue:p-3">
                <ErrorText>{detail.error || detail.data?.node.error}</ErrorText>
                {detail.data && (
                  <table className="ue:w-full ue:border-separate ue:border-spacing-0">
                    <tbody>
                      {detail.data.node.pins.map((p) => (
                        <tr key={p.dir + p.name}>
                          <td className="ue:w-10 ue:py-0.5 ue:text-caption ue:text-subtle">
                            {p.dir === 'in' ? t('入') : t('出')}
                          </td>
                          <td className="ue:py-0.5 ue:pr-3 ue:font-mono ue:text-fg">{p.name}</td>
                          <td className="ue:py-0.5 ue:pr-3 ue:text-subtle">{p.type}</td>
                          <td className="ue:py-0.5 ue:font-mono ue:break-all">
                            {(p.to ?? []).map((link) => (
                              <button
                                key={link}
                                type="button"
                                className="ue:mr-2 ue:cursor-pointer ue:text-accent-text ue:hover:underline"
                                onClick={() => setNode(link.split('.')[0])}
                              >
                                → {link}
                              </button>
                            ))}
                            {p.default !== undefined && <span className="ue:text-subtle">= {p.default}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

const signature = (g: GraphBrief) => {
  const list = (ps?: Param[]) => (ps ?? []).map((p) => `${p.name}: ${p.type}`).join(', ')
  if (g.events?.length) return g.events.map((e) => e.name).join('\n')
  return g.inputs || g.outputs ? `(${list(g.inputs)})${g.outputs?.length ? ` → (${list(g.outputs)})` : ''}` : g.name
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="ue:px-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-subtle">{title}</h4>
      <ul className="ue:flex ue:flex-col">{children}</ul>
    </section>
  )
}

/** 组件树的一行：点名字去看这个组件模板的属性 */
function ComponentRow({ c, depth, onOpen }: { c: Component; depth: number; onOpen: (path: string) => void }) {
  return (
    <>
      <li className="ue:flex ue:items-center ue:gap-2 ue:py-1 ue:pr-2" style={{ paddingLeft: 8 + depth * 14 }}>
        {c.template ? (
          <button
            type="button"
            className="ue:cursor-pointer ue:truncate ue:font-mono ue:text-accent-text ue:hover:underline"
            onClick={() => onOpen(c.template!)}
          >
            {c.name}
          </button>
        ) : (
          <span className="ue:truncate ue:font-mono ue:text-fg">{c.name}</span>
        )}
        <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{c.class}</span>
      </li>
      {(c.children ?? []).map((x) => (
        <ComponentRow key={x.name} c={x} depth={depth + 1} onOpen={onOpen} />
      ))}
    </>
  )
}

/** 伪代码的一行：行尾的 #节点id 单独淡显、可点；注释行整行淡显 */
function PseudoLine({ line, active, onNode }: { line: string; active: string; onNode: (id: string) => void }) {
  const m = /^(.*?)(\s{2}#([0-9a-f]{6,32}))?$/.exec(line)
  const text = m?.[1] ?? line
  const id = m?.[3]
  const comment = text.trimStart().startsWith('//')
  return (
    <div className={h().cn('ue:flex ue:gap-3 ue:whitespace-pre', id && id === active && 'ue:bg-term-sel')}>
      <span className={comment ? 'ue:text-term-dim' : undefined}>{text || ' '}</span>
      {id && (
        <button
          type="button"
          className="ue:ml-auto ue:shrink-0 ue:cursor-pointer ue:text-term-dim ue:hover:underline"
          onClick={() => onNode(id)}
        >
          #{id}
        </button>
      )}
    </div>
  )
}
