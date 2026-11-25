import { useEffect, useRef, useState } from 'react'
import type { GmRun } from '../../../../server/store.ts'
import { argsText, dropCommon, inCommon, objKey, renameCommonKey, toggleCommon } from '../../../../shared/gm/common.ts'
import { callText } from '../../../../shared/gm/custom.ts'
import type { GtRef } from '../../../../shared/gt-script/ref/types.ts'
import type { GmCustom, GmCustomObj, GmMany, GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import { allModules } from '../../../../shared/gm/modules.ts'
import { CUSTOM_FOLDER } from '../../../../shared/gm/obj-folders.ts'
import { narrowMany, narrowRef } from '../../../../shared/gm/pick.ts'
import { useAsk } from '../../../ask.tsx'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { useLocalPref } from '../nav/local.ts'
import { RefDialog } from '../../uekit/gt-ref/RefDialog.tsx'
import type { GmData } from '../use-gm.ts'
import { addCustom } from '../custom/build-custom.ts'
import { argValue, type CallParam } from '../../../obj-kit/CallForm.tsx'
import { outLine, runCall, type CallOut } from '../custom/run-custom.ts'
import { SaveGmDialog } from '../custom/SaveGmDialog.tsx'
import { customParams } from '../custom/custom-params.ts'
import type { CallMode } from './CallPane.tsx'
import type { FnInfo } from '../../../obj-kit/members.ts'
import type { MemberTab } from '../../../obj-kit/MemberPane.tsx'
import type { VarSel } from '../../../obj-kit/VarList.tsx'
import { useObjFolders } from './use-obj-folders.tsx'
import { useObjHits, type ParamClass } from './use-objcall.ts'

/** 函数参数已关联的表格（tableBindings 键「函数名.参数名」，和参数表单读的同一份）→ 参数名 → 「表格 · 列」 */
const tablesOf = (g: GmStore, fn?: string) => {
  const out: Record<string, string> = {}
  if (!fn) return out
  for (const [k, b] of Object.entries(g.tableBindings ?? {}))
    if (k.startsWith(`${fn}.`)) out[k.slice(fn.length + 1)] = `${b.table.split('/').pop()} · ${b.key}`
  return out
}

/** 对象列表 → 调用时的 objects：只要用到的那几个 */
const objectsFor = (list: GmObject[], names: string[]) => {
  const out: Record<string, GmCustomObj> = {}
  for (const n of names) {
    const o = list.find((x) => x.name === n)
    if (o) out[n] = o.src ? { src: o.src } : { ref: o.ref! }
  }
  return out
}

/**
 * 对象调用的状态和动作（规格第 7 节）：选中的对象、选中的函数和填的参数、命中多个怎么办、取对象读哪些属性、上次的输出，
 * 以及对象列表的增删改（选对象面板、起名字）和「保存为 GM」。GM 页左栏的对象列表、右边的工作台都从这里取
 */
/** 属性路径 → 显示用的变量名：@.Gold / @#hp / @/Txt.Text → 最后一段 */
const varName = (prop: string) =>
  prop
    .replace(/^@[./#:]?/, '')
    .split(/[./#]/)
    .pop() || prop

export function useObjCallState(d: GmData, live: boolean) {
  const { project, target } = useUe()
  const { toast } = h()
  const [dialog, ask] = useAsk()
  const objects = d.gm.objects
  const [sel, setSel] = useKept<string>(`gm-obj/${project.id}`, '')
  const [tab, setTab] = useState<MemberTab>('fns')
  const [mode, setMode] = useState<CallMode>('call')
  const [fn, setFn] = useState<FnInfo>()
  // 中栏点的变量（右栏「改变量」）
  const [varSel, setVarSel] = useState<VarSel>()
  // 改完变量加一：中栏属性列表重读
  const [varRev, setVarRev] = useState(0)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [many, setMany] = useState<GmMany>('error')
  const [picked, setPicked] = useState<string[]>([])
  // 挑实例（F2）：命中多个时只对勾的这几个生效（对象名），换对象清空
  const [only, setOnly] = useState<string[]>([])
  // 钉住的属性（F4）：对象名 → 属性路径，记在本机
  const [pinMap, setPinMap] = useLocalPref<Record<string, string[]>>(`pins/${project.id}`, {})
  const [out, setOut] = useState<CallOut>()
  const [sentArgs, setSentArgs] = useState<Record<string, unknown>>()
  const [running, setRunning] = useState(false)
  const [refEdit, setRefEdit] = useState<{ value?: GtRef; lockClass?: string; done: (ref: GtRef) => void }>()
  // 保存为 GM 弹窗：true 是存当前工作台的调用；from 是最近执行里一条自定义 GM 的那组参数（「存成 GM…」）
  // 保存为 GM 弹窗：true 是调函数 / 读取，{c, args} 是从调用记录另存，{set} 是改值面板存的「改这个变量」
  const [saving, setSaving] = useState<
    | false
    | true
    | { c: GmCustom; args: Record<string, unknown> }
    | { set: { prop: string; type: string; value: unknown } }
  >(false)
  // 模块右键「在这个模块里新建 GM」记下的模块：下次保存为 GM 时默认选它
  const [saveModule, setSaveModule] = useState<string>()
  const { hits } = useObjHits(
    project.id,
    live,
    objects.map((o) => ({ name: o.name, o })),
  )
  const obj = objects.find((o) => o.name === sel) ?? objects[0]
  // 打开自定义 GM 时只知道函数名、不知道签名：中栏列出函数后按名字补上（B5）
  const [fnNeedsSig, setFnNeedsSig] = useState(false)

  // 对象变了（不管是点了别的、删了当前的落到第一个、还是改名）都清掉工作台（B6：以前只有点别的对象才清，
  // 删掉当前对象后右栏还留着上一个对象的函数和参数，点调用会调到新对象上）
  const lastObj = useRef(obj?.name)
  const keepBench = useRef(false)
  useEffect(() => {
    if (lastObj.current === obj?.name) return
    lastObj.current = obj?.name
    // 打开自定义 GM、从记录填回：先选对象再填函数，这一次不清
    if (keepBench.current) {
      keepBench.current = false
      return
    }
    setFn(undefined)
    setFnNeedsSig(false)
    setVarSel(undefined)
    setOut(undefined)
    setPicked([])
    setOnly([])
    setMode('call')
  }, [obj?.name])

  const save = (next: GmObject[]) => d.saveGm({ ...d.gm, objects: next })
  const fold = useObjFolders(d)
  /** 加进对象列表：问名字和文件夹（必须选一个，用户 2026-11-22）；folder 是默认选的文件夹 */
  const addObject = async (o: Omit<GmObject, 'name' | 'folder'>, init: string, folder?: string) => {
    const r = await fold.askObj({ title: t('加进对象列表'), name: init, folder: folder ?? obj?.folder })
    if (!r) return undefined
    await save([...objects, { name: r.name, ...o, folder: r.folder } as GmObject])
    setSel(r.name)
    return r.name
  }
  const pickFn = (f: FnInfo) => {
    setFn(f)
    setMode('call')
    setValues((v) => Object.fromEntries(f.params.map((p) => [p.name, v[p.name] ?? (p.obj ? undefined : '')])))
  }

  /** 挑了实例时，当前对象的规则收窄到勾的那几个（只用于这次执行） */
  const narrowed = (o: GmObject): GmObject => (o.ref && only.length ? { ...o, ref: narrowRef(o.ref, only) } : o)
  /** 这次调用的定义：参数按类型转好，空的普通参数不传（用函数的默认值）；narrow 时带上挑的实例（保存为 GM 时不带） */
  const def = (narrow = false) => {
    const args: Record<string, unknown> = {}
    for (const p of fn?.params ?? []) {
      const v = values[p.name]
      if (p.obj) {
        if (v !== undefined) args[p.name] = v
      } else if (v !== '' && v !== undefined) args[p.name] = argValue(p.type, v)
    }
    const names = [
      obj!.name,
      ...Object.values(args).flatMap((v) =>
        v && typeof v === 'object' && '$obj' in v ? [String((v as { $obj: string }).$obj)] : [],
      ),
    ]
    const list = narrow ? objects.map((o) => (o.name === obj!.name ? narrowed(o) : o)) : objects
    return {
      kind: mode === 'get' ? ('get' as const) : ('call' as const),
      obj: obj!.name,
      objects: objectsFor(list, names),
      function: fn?.name,
      args,
      // 函数的全部参数一起存：没填的参数也在，保存成 GM 后照样显示、执行时照样能填
      params: fn?.params ?? [],
      many: narrow ? narrowMany(only, many) : many,
      props: picked,
    }
  }
  /** 记进调用记录（对象调用页底栏，B1 / F1）：和 GM 的最近执行同一份本机数据，key 是 objcall:<对象名> */
  const record = (r: Omit<GmRun, 'key' | 'at'> & { at?: string }) =>
    d.pushRecent({ ...r, key: `objcall:${r.call?.obj ?? ''}`, at: r.at ?? new Date().toISOString() })
  const run = async () => {
    if (!obj) return
    const x = def(true)
    setRunning(true)
    setSentArgs(x.args)
    const r = await runCall(project.id, x, x.args, target)
    setOut(r)
    setRunning(false)
    record({
      name:
        x.kind === 'get'
          ? t('读取 {p}', { p: picked.join(', ') || t('命中的实例') })
          : `${fn?.name ?? ''}(${argsText(x.args).split(' ').join(', ')})`,
      args: x.args,
      code: callText({ obj: obj.name, function: fn?.name, kind: x.kind, props: picked }, x.args),
      ok: r.ok,
      out: outLine(r),
      at: r.at,
      call: { obj: obj.name, mode: x.kind, fn: fn?.name, props: x.kind === 'get' ? picked : undefined, many },
    })
  }

  /** 调用记录里点一行：选上那个对象，函数 / 读取的属性和参数填回去（函数签名等中栏列出来再补，B5 同一套） */
  const restore = (r: GmRun) => {
    const c = r.call
    if (!c || !objects.some((o) => o.name === c.obj)) return
    keepBench.current = c.obj !== obj?.name
    setSel(c.obj)
    setOut(undefined)
    if (c.mode === 'get') {
      setMode('get')
      setTab('props')
      setPicked(c.props ?? [])
      return
    }
    if (c.mode === 'set') {
      setTab('props')
      return
    }
    setMode('call')
    setTab('fns')
    if (c.many) setMany(c.many as GmMany)
    const args = Array.isArray(r.args) ? {} : r.args
    setValues(args)
    setFn({
      name: c.fn ?? '',
      sig: '',
      src: 'cpp',
      owner: '',
      params: Object.keys(args).map((n) => ({ name: n, type: '' })),
      callable: true,
    })
    setFnNeedsSig(true)
  }

  const listProps = {
    objects,
    hits,
    live,
    selected: obj?.name ?? '',
    onPick: (n: string) => setSel(n),
    ...fold.actions,
    onAdd: (folder?: string) =>
      setRefEdit({
        done: (ref) =>
          void addObject(
            { ref: ref as GmObject['ref'] },
            ref.class
              .replace(/^lua:/, '')
              .replace(/^.*[./]/, '')
              .replace(/_C$/, ''),
            folder,
          ),
      }),
    onAddSource: async (kind: 'pawn' | 'sub' | 'luaMod', folder?: string) => {
      if (kind === 'pawn') return void addObject({ src: '@pawn' }, t('玩家'), folder)
      const label = kind === 'sub' ? t('子系统的类名（例如 UQuestSubsystem）') : t('Lua 模块名（require 的路径）')
      const v = (await ask({ title: kind === 'sub' ? t('加子系统') : t('加 Lua 模块'), label, init: '' }))?.trim()
      if (v) void addObject({ src: `@${kind}.${v}` }, v.split('.').pop() ?? v, folder)
    },
    onEdit: (o: GmObject) =>
      setRefEdit({
        value: o.ref as GtRef,
        done: (ref) =>
          void save(
            objects.map((x) =>
              x.name === o.name
                ? { name: o.name, ref: ref as GmObject['ref'], ...(o.folder ? { folder: o.folder } : {}) }
                : x,
            ),
          ),
      }),
    onRename: async (o: GmObject) => {
      const n = (await fold.askObj({ title: t('重命名对象'), name: o.name, self: o.name, noFolder: true }))?.name
      if (!n || n === o.name) return
      await d.saveGm(
        renameCommonKey(
          { ...d.gm, objects: objects.map((x) => (x.name === o.name ? { ...x, name: n } : x)) },
          objKey(o.name),
          objKey(n),
        ),
      )
      if (obj?.name === o.name) {
        keepBench.current = true
        setSel(n)
      }
    },
    onCopy: async (o: GmObject) => {
      const { name: _n, by: _b, folder, ...rest } = o
      await addObject(rest, t('{n} 副本', { n: o.name }), folder)
    },
    onDelete: async (o: GmObject) => {
      const ok = await ask({ title: t('删除对象「{n}」？', { n: o.name }), okText: t('删除'), danger: true })
      if (ok === undefined) return
      await d.saveGm(dropCommon({ ...d.gm, objects: objects.filter((x) => x.name !== o.name) }, [objKey(o.name)]))
    },
    /** 对象右键「调函数」「读取…」：选上这个对象，中栏切到要用的那一页（读取时属性行出勾选） */
    onCall: (n: string, m: CallMode) => {
      if (n !== obj?.name) keepBench.current = false
      setSel(n)
      setMode(m)
      setTab(m === 'get' ? 'props' : 'fns')
    },
    isFav: (n: string) => inCommon(d.gm, { key: objKey(n) }),
    onFav: (n: string) => void d.saveGm(toggleCommon(d.gm, { key: objKey(n) })),
  }

  /** 对象参数「新的匹配规则…」：选对象面板的类定成参数类型，保存后进对象列表并选上 */
  const onNewRule = (p: CallParam & { obj: ParamClass }) =>
    setRefEdit({
      lockClass: p.obj.lua ? `lua:${p.obj.cls}` : p.obj.cls,
      done: async (ref) => {
        const name = await addObject({ ref: ref as GmObject['ref'] }, p.name)
        if (name) setValues((v) => ({ ...v, [p.name]: { $obj: name } }))
        if (obj) setSel(obj.name)
      },
    })

  /** GM 页自定义 GM 的「在对象调用里打开」：对象列表里没有的对象先加进来（同名的不覆盖），再填好函数和参数 */
  const openCustom = async (c: GmCustom) => {
    // 对象列表里有同名对象但规则不一样（B4）：不拿列表里的冒充，加一个「名字 (2)」用这条 GM 自己的规则，参数里的引用跟着换
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    const taken = new Set(objects.map((o) => o.name))
    const rename = new Map<string, string>()
    const add: GmObject[] = []
    for (const [name, o] of Object.entries(c.objects)) {
      const have = objects.find((x) => x.name === name)
      if (have && same(have.ref, o.ref) && same(have.src, o.src)) continue
      let n = name
      for (let i = 2; have && taken.has(n); i++) n = `${name} (${i})`
      taken.add(n)
      if (n !== name) rename.set(name, n)
      // 对象都要在文件夹里：自动加进来的放「来自自定义 GM」
      add.push({ name: n, ...o, folder: CUSTOM_FOLDER } as GmObject)
    }
    if (add.length) await save([...objects, ...add])
    if (rename.size)
      toast.success(
        t('对象列表里已有同名但规则不同的对象，这条 GM 的规则另存成了：{n}', { n: [...rename.values()].join('、') }),
      )
    const nm = (n: string) => rename.get(n) ?? n
    keepBench.current = nm(c.obj) !== obj?.name
    setSel(nm(c.obj))
    // 改变量的 GM 打开到「属性」页签：右栏的改值要先在中栏点那个变量（拿到类型才知道怎么填）
    setMode(c.kind === 'set' ? 'call' : c.kind)
    setTab(c.kind === 'call' ? 'fns' : 'props')
    setMany(c.many)
    setPicked(c.props ?? [])
    setValues(
      Object.fromEntries(
        Object.entries(c.args).map(([k, v]) =>
          v && typeof v === 'object' && '$obj' in v ? [k, { $obj: nm(String((v as { $obj: string }).$obj)) }] : [k, v],
        ),
      ),
    )
    setFnNeedsSig(!!c.function)
    setFn(
      c.function
        ? {
            name: c.function,
            sig: '',
            src: 'cpp',
            owner: '',
            params: customParams(c),
            callable: true,
          }
        : undefined,
    )
  }

  const dialogs = (
    <>
      {dialog}
      {fold.dialogs}
      {refEdit && (
        <RefDialog
          project={project.id}
          value={refEdit.value}
          lockClass={refEdit.lockClass}
          onClose={() => setRefEdit(undefined)}
          onSave={(_name, ref) => {
            setRefEdit(undefined)
            refEdit.done(ref)
          }}
        />
      )}
      {saving && typeof saving === 'object' && 'c' in saving && (
        <SaveGmDialog
          init={{
            name: saving.c.name,
            note: saving.c.note,
            module: saving.c.module,
          }}
          modules={allModules(d.gm, [])}
          obj={{ name: saving.c.obj, o: saving.c.objects[saving.c.obj] ?? {} }}
          fn={saving.c.kind === 'call' ? saving.c.function : undefined}
          args={saving.c.kind === 'call' ? saving.args : {}}
          params={saving.c.kind === 'call' ? customParams(saving.c) : undefined}
          tables={saving.c.kind === 'call' ? tablesOf(d.gm, saving.c.function) : undefined}
          props={saving.c.kind === 'get' ? saving.c.props : undefined}
          onClose={() => setSaving(false)}
          onSave={async (r) => {
            const c = saving.c
            try {
              // 对象从这条 GM 自己的副本里取（对象列表里可能已经改了、删了）
              const objs = Object.entries(c.objects).map(([name, o]) => ({ name, ...o }) as GmObject)
              const res = addCustom(d.gm, { ...c, objects: objs, args: saving.args }, r)
              // 先关弹窗再等写盘：GM 列表里马上就有（saveGm 先改页面上的），写完再提示；
              // 以前等写完才关，请求慢时点了像没反应，连点几下就存几遍
              setSaving(false)
              if (await d.saveGm(res.g)) toast.success(t('已存成 GM「{n}」', { n: r.name }))
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        />
      )}
      {saving && typeof saving === 'object' && 'set' in saving && obj && (
        <SaveGmDialog
          init={{ name: t('{n} · 改 {p}', { n: obj.name, p: varName(saving.set.prop) }), module: saveModule }}
          modules={allModules(d.gm, [])}
          obj={{ name: obj.name, o: obj }}
          args={{ value: saving.set.value }}
          setProp={{ prop: saving.set.prop, type: saving.set.type }}
          onClose={() => setSaving(false)}
          onSave={async (r) => {
            const x = saving.set
            try {
              const res = addCustom(
                d.gm,
                {
                  kind: 'set',
                  obj: obj.name,
                  objects,
                  prop: x.prop,
                  args: { value: x.value },
                  params: [{ name: 'value', type: x.type }],
                  many: 'error',
                },
                r,
              )
              setSaving(false)
              if (await d.saveGm(res.g)) toast.success(t('已存成 GM「{n}」', { n: r.name }))
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        />
      )}
      {saving === true && obj && (
        <SaveGmDialog
          init={{
            name: fn ? `${obj.name} · ${fn.name}` : t('{n} · 取对象', { n: obj.name }),
            module: saveModule,
          }}
          modules={allModules(d.gm, [])}
          obj={{ name: obj.name, o: obj }}
          fn={mode === 'call' ? fn?.name : undefined}
          args={mode === 'call' ? def().args : {}}
          params={mode === 'call' ? fn?.params : undefined}
          tables={mode === 'call' ? tablesOf(d.gm, fn?.name) : undefined}
          props={mode === 'get' ? picked : undefined}
          onClose={() => setSaving(false)}
          onSave={async (r) => {
            try {
              const x = def()
              const res = addCustom(d.gm, { ...x, objects }, r)
              setSaving(false)
              if (await d.saveGm(res.g)) toast.success(t('已存成 GM「{n}」', { n: r.name }))
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        />
      )}
    </>
  )

  return {
    obj,
    listProps,
    dialogs,
    openCustom,
    /** 选对象面板改一条匹配规则（GM 页自定义 GM 的「改匹配规则」也用这一个弹窗） */
    editRef: (value: GtRef | undefined, done: (ref: GtRef) => void) => setRefEdit({ value, done }),
    /** 最近执行里自定义 GM 的「存成 GM…」：用当时那组参数另存（名字不改就是更新这条） */
    saveFrom: (c: GmCustom, args: Record<string, unknown>) => setSaving({ c, args }),
    restore,
    /** 模块右键「在这个模块里新建 GM」：之后保存为 GM 默认放进这个模块 */
    preferModule: (id: string) => setSaveModule(id),
    bench: {
      varSel,
      varRev,
      varChanged: (r: { ok: boolean; value: string; error?: string }) => {
        if (r.ok) setVarRev((x) => x + 1)
        if (obj && varSel)
          record({
            name: `${varSel.name} = ${r.value}`,
            args: { [varSel.prop]: r.value },
            code: t('在 {o} 上改 {p} = {v}', { o: obj.name, p: varSel.prop, v: r.value }),
            ok: r.ok,
            out: r.error ?? '',
            call: { obj: obj.name, mode: 'set', fn: varSel.prop },
          })
      },
      /** 中栏点了变量：右栏切到「改变量」 */
      pickVar: (v: VarSel) => {
        setVarSel(v)
        setMode('set')
      },
      tab,
      setTab,
      mode,
      setMode,
      fn,
      fnNeedsSig,
      /** 中栏列出函数了：补上签名（打开自定义 GM、从记录填回时只有名字） */
      fillSig: (f: FnInfo) => {
        setFnNeedsSig(false)
        pickFn(f)
      },
      pickFn: (f: FnInfo) => {
        setFnNeedsSig(false)
        pickFn(f)
      },
      values,
      setValue: (n: string, v: unknown) => setValues((x) => ({ ...x, [n]: v })),
      many,
      setMany,
      picked,
      togglePick: (p: string) => setPicked((l) => (l.includes(p) ? l.filter((x) => x !== p) : [...l, p])),
      out,
      sentArgs,
      running,
      run: () => void run(),
      save: () => setSaving(true),
      saveVar: (set: { prop: string; type: string; value: unknown }) => setSaving({ set }),
      onNewRule,
      hits,
      only,
      setOnly,
      pins: obj ? (pinMap[obj.name] ?? []) : [],
      togglePin: (p: string) => {
        if (!obj) return
        const cur = pinMap[obj.name] ?? []
        const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
        const m = { ...pinMap, [obj.name]: next }
        if (!next.length) delete m[obj.name]
        setPinMap(m)
      },
      /** 改值时用的对象：挑了实例就是收窄后的 */
      target: obj ? narrowed(obj) : undefined,
    },
  }
}

export type ObjCallState = ReturnType<typeof useObjCallState>
