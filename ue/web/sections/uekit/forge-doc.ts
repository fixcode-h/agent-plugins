/**
 * AssetForge 配置文本的小工具：配置允许 // 注释（UEKit ForgeJsonText），浏览器的 JSON.parse 不认，
 * 编辑器里的语法检查、复制一份、项目模板都先去掉注释再解析。
 */

/** 去掉字符串外面的 // 和 /* *\/ 注释，换行留着（报错的行号才对得上） */
export function stripComments(text: string) {
  let out = ''
  let i = 0
  let str = false
  while (i < text.length) {
    const c = text[i]
    if (str) {
      out += c
      if (c === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === '"') str = false
      i++
      continue
    }
    if (c === '"') {
      str = true
      out += c
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n'
        i++
      }
      i += 2
    } else {
      out += c
      i++
    }
  }
  return out
}

export type ParsedDoc = { ok: true; doc: Record<string, unknown> } | { ok: false; error: string; line?: number }

/** 解析配置；出错时给出第几行（V8 的报错多数不带位置，自己再扫一遍找出错的地方） */
export function parseDoc(text: string): ParsedDoc {
  const src = stripComments(text)
  try {
    const doc = JSON.parse(src) as unknown
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'not an object' }
    return { ok: true, doc: doc as Record<string, unknown> }
  } catch (e) {
    const at = errorAt(src)
    return { ok: false, error: (e as Error).message, line: at < 0 ? undefined : src.slice(0, at).split('\n').length }
  }
}

/** 最小的 JSON 扫描：只为找第一个出错的位置（找不到回 -1），值本身交给 JSON.parse */
function errorAt(s: string): number {
  let i = 0
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++
  }
  const fail = () => {
    throw i
  }
  const str = () => {
    if (s[i] !== '"') fail()
    i++
    while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1
    if (i >= s.length) fail()
    i++
  }
  const value = (): void => {
    ws()
    const c = s[i]
    if (c === '{') {
      i++
      ws()
      if (s[i] === '}') return void i++
      for (;;) {
        ws()
        str()
        ws()
        if (s[i] !== ':') fail()
        i++
        value()
        ws()
        if (s[i] === ',') i++
        else if (s[i] === '}') return void i++
        else fail()
      }
    }
    if (c === '[') {
      i++
      ws()
      if (s[i] === ']') return void i++
      for (;;) {
        value()
        ws()
        if (s[i] === ',') i++
        else if (s[i] === ']') return void i++
        else fail()
      }
    }
    if (c === '"') return str()
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 40))
    if (!m) fail()
    i += m![0].length
  }
  try {
    value()
    ws()
    return i < s.length ? i : -1
  } catch (at) {
    return typeof at === 'number' ? Math.min(at, s.length - 1) : -1
  }
}

const lastName = (asset: unknown) =>
  String(asset ?? '')
    .replace(/\.[^/]*$/, '')
    .split('/')
    .pop() ?? ''

/**
 * 把一份配置（现有配置或模板）改成指向新资产：换 asset，根节点名和旧资产同名时一起换；
 * 去掉模板说明 template、修订号归零。返回新文档对象，读不懂时抛错
 */
export function retarget(text: string, asset: string, name: string) {
  const p = parseDoc(text)
  if (!p.ok) throw new Error(p.error)
  const { template: _t, ...doc } = p.doc
  const old = lastName(doc.asset)
  const root = doc.root as Record<string, unknown> | undefined
  return {
    ...doc,
    revision: 0,
    asset,
    ...(root && typeof root === 'object' ? { root: { ...root, ...(root.name === old && old ? { name } : {}) } } : {}),
  }
}

/** 项目模板说明（模板文件里可选的 template 字段）：label 显示名、desc 一句话 */
export function templateMeta(doc: Record<string, unknown>) {
  const m = (doc.template ?? {}) as { label?: unknown; desc?: unknown }
  return {
    label: typeof m.label === 'string' ? m.label : undefined,
    desc: typeof m.desc === 'string' ? m.desc : undefined,
  }
}
