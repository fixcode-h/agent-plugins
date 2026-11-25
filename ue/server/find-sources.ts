import type { ExternalFindSource, FindHit, FindRequest } from '../../sdk/server.ts'

/**
 * UE 项目找代码的路（面板插件接口 21 的 findSources，面板 ADR 0081 能力路由）：
 * C++ 走 VS 里 UEToVS 的符号索引，Lua 走 IDEA 里 EmmyLua 的 lua_code。这里只描述工具名、参数和结果怎么读，
 * 服务开没开、IDE 的 projectPath、仅路由器、建索引时等待都由面板处理，Agent 只调面板的 find、看不到这些工具。
 * 分页由面板做（几条路合并后才分页）：这里要 offset + limit 条、从头开始
 */

const want = (r: FindRequest, max: number) => Math.min(max, r.offset + r.limit)
const scope = (r: FindRequest) => (r.wide ? 'all' : 'project')
const CPP_FILE = /\.(h|hpp|hh|hxx|inl|c|cc|cpp|cxx|ipp)$/i
const OTHER_FILE = /\.(h|hpp|hh|hxx|inl|c|cc|cpp|cxx|cs|ts|tsx|js|json|ini|py|md|txt|uasset|umap)$/i
const isLuaTarget = (q: string) => /\.lua$/i.test(q) || (!/[\\/]/.test(q) && !OTHER_FILE.test(q))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)

/** UEToVS find_references：按文件分组 {files:[{file, hits:[{line,col,kind,text}]}]} */
function uetovsRefs(json: unknown) {
  const o = obj(json)
  const hits: FindHit[] = []
  for (const f of Array.isArray(o?.files) ? o.files : []) {
    const file = str(obj(f)?.file)
    if (!file) continue
    for (const h of Array.isArray(obj(f)?.hits) ? (obj(f)!.hits as unknown[]) : []) {
      const x = obj(h)
      if (!x) continue
      const kind = str(x.kind)
      hits.push({
        file,
        ...(num(x.line) && { line: num(x.line) }),
        ...(num(x.col) && { col: num(x.col) }),
        ...(str(x.text) && { text: str(x.text) }),
        ...(kind && { kind }),
        rank: kind && /declaration|definition/.test(kind) ? 0 : 1,
      })
    }
  }
  return { hits, ...(o?.hasMore === true && { more: true }), ...(str(o?.note) && { note: str(o?.note) }) }
}

/** UEToVS suggest_include：一条 {include, header, module, warning} */
function uetovsInclude(json: unknown) {
  const o = obj(json)
  const header = str(o?.header)
  if (!header) return { hits: [], ...(str(o?.note) && { note: str(o?.note) }) }
  const sym = obj(o?.symbol)
  const text = [str(o?.include), str(o?.module) && `模块 ${str(o?.module)}`, str(o?.warning)].filter(Boolean).join('  ')
  return {
    hits: [{ file: header, ...(num(sym?.line) && { line: num(sym?.line) }), ...(text && { text }), rank: 0 as const }],
  }
}

export function ueFindSources(): ExternalFindSource[] {
  const cpp = { langs: ['cpp' as const], rank: 10 }
  const lua = { langs: ['lua' as const], rank: 10 }
  return [
    {
      ...cpp,
      id: 'uetovs.search_symbols',
      tool: 'search_symbols',
      kinds: ['symbol'],
      args: (r) => ({ query: r.query, scope: scope(r), limit: want(r, 200) }),
    },
    {
      ...cpp,
      id: 'uetovs.find_references',
      tool: 'find_references',
      kinds: ['refs'],
      args: (r) => ({ symbol: r.query, scope: scope(r), limit: want(r, 1000) }),
      parse: uetovsRefs,
      // VS 的引用是按语义查的，C++ 里没有 Lua 那种字符串调用，不再用文本补（大工程按文本扫一遍要几十秒）
      final: true,
    },
    {
      ...cpp,
      id: 'uetovs.get_file_outline',
      tool: 'get_file_outline',
      kinds: ['outline'],
      args: (r) => (CPP_FILE.test(r.query) ? { path: r.query, limit: want(r, 2000) } : null),
    },
    {
      ...cpp,
      id: 'uetovs.get_members',
      tool: 'get_members',
      kinds: ['members'],
      args: (r) => ({ type_name: r.query, limit: want(r, 2000) }),
    },
    {
      ...cpp,
      id: 'uetovs.suggest_include',
      tool: 'suggest_include',
      kinds: ['include'],
      args: (r) => ({ type: r.query }),
      parse: uetovsInclude,
    },
    {
      ...lua,
      id: 'emmylua.lua_code.search',
      tool: 'lua_code',
      kinds: ['symbol'],
      args: (r) => ({ action: 'search', query: r.query, limit: want(r, 200) }),
    },
    {
      ...lua,
      id: 'emmylua.lua_code.references',
      tool: 'lua_code',
      kinds: ['refs'],
      // 查到的是静态引用，面板会再用文本补一遍字符串调用、反射这类动态写法（final 不写，默认还要补）
      args: (r) => ({
        action: 'references',
        query: r.query,
        ...(r.file && { file: r.file }),
        ...(r.line && { line: r.line }),
        limit: want(r, 200),
      }),
    },
    {
      ...lua,
      id: 'emmylua.lua_code.outline',
      tool: 'lua_code',
      kinds: ['outline'],
      // .lua 文件或模块名（UI.MainPanel：不带路径分隔、也不是别的语言的扩展名）
      args: (r) => (isLuaTarget(r.query) ? { action: 'outline', path: r.query, limit: want(r, 200) } : null),
    },
  ]
}
