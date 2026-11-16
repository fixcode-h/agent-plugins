import { runOp, type OpCtx } from '../ops.ts'
import { configView } from './config.ts'
import { listTags, tagRefs } from './tags.ts'

/**
 * ue_console 的 config / tags、ue_editor 的 spawn / destroy（工具定义在 tools.ts，这里是给 Agent 的结果整理）。
 * 返回默认不超过 4000 字（ADR 0067）：列表只给名字，超出的说清楚怎么缩小范围。
 */
const LIMIT = 4000
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))

function fit(data: unknown, hint: string) {
  const text = JSON.stringify(data, null, 1)
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT)}\n…（太长截断了：${hint}）`
}

export async function consoleConfig(ctx: OpCtx, a: Record<string, unknown>) {
  const r = await configView(ctx, {
    file: s(a.file) || undefined,
    section: s(a.section) || undefined,
    key: s(a.key) || undefined,
    filter: s(a.filter) || undefined,
    query: s(a.query) || undefined,
  })
  if ('hits' in r)
    return fit(
      { query: r.query, more: r.more, hits: r.hits.map((h) => `${h.type} [${h.section}] ${h.key}=${h.value} · ${h.layer}:${h.line}`) },
      '换更具体的 query',
    )
  if ('types' in r) return fit({ files: r.types, next: '给 file（如 Engine）列 section' }, '')
  if ('sections' in r)
    return fit(
      {
        file: r.file,
        live: r.live,
        sections: r.sections.map((x) => x.name),
        next: '给 section 看各层写法和最终值',
      },
      '用 filter 按 section 名筛',
    )
  return fit(
    {
      file: r.file,
      section: r.section,
      live: r.live,
      keys: r.keys.map((k) => ({
        key: k.key,
        value: k.values.length > 1 ? k.values : k.values[0],
        last: k.last || undefined,
        ...(k.live && { live: k.live.length > 1 ? k.live : k.live[0] }),
        ...(k.differs && { differs: true }),
        layers: k.layers.map((l) => `${l.label}: ${l.entries.map((e) => `${e.op}${e.key}=${e.value}`).join(' ; ')}`),
      })),
    },
    '用 key 只看一个键',
  )
}

export async function consoleTags(ctx: OpCtx, a: Record<string, unknown>) {
  if (s(a.tag)) {
    const r = (await tagRefs(ctx, s(a.tag))) as { items?: string[]; total?: number; loading?: boolean }
    return fit({ tag: a.tag, total: r.total, loading: r.loading, referencers: r.items }, '引用太多，换更具体的子 Tag')
  }
  const r = await listTags(ctx, s(a.query))
  return fit(
    {
      live: r.live,
      ...('note' in r && r.note && { note: `UE 没连上，只列了 ini 里写的 Tag：${r.note}` }),
      total: r.total,
      tags: r.items.map((i) => (i.comment ? `${i.tag} — ${i.comment}` : i.tag)),
    },
    '用 query 按名字筛',
  )
}

/** 放 / 删 Actor 只对编辑器世界：不管网页上选的目标是不是游戏进程，都发给编辑器 */
export async function editorSpawn(ctx: OpCtx, a: Record<string, unknown>) {
  return runOp({ ...ctx, target: { instance: 'editor' } }, 'editor.spawn', {
    class: a.class,
    location: a.location,
    rotation: a.rotation,
    label: a.label,
    level: a.level,
    folder: a.folder,
  })
}

export async function editorDestroy(ctx: OpCtx, a: Record<string, unknown>) {
  return runOp({ ...ctx, target: { instance: 'editor' } }, 'editor.destroy', { actors: a.actors })
}
