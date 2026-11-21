import { useState } from 'react'
import type { GtRef } from '../../../../shared/gt-script/ref/types.ts'
import type { GmCustom, GmCustomObj, GmMany, GmObject } from '../../../../shared/gm/schema.ts'
import { toggleFav } from '../../../../shared/gm/favs.ts'
import { allModules } from '../../../../shared/gm/modules.ts'
import { useAsk } from '../../../ask.tsx'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { RefDialog } from '../../uekit/gt-ref/RefDialog.tsx'
import type { GmData } from '../use-gm.ts'
import { addCustom } from '../custom/build-custom.ts'
import { argValue, type CallParam } from '../custom/CallForm.tsx'
import { runCall, type CallOut } from '../custom/run-custom.ts'
import { SaveGmDialog } from '../custom/SaveGmDialog.tsx'
import type { CallMode } from './CallPane.tsx'
import type { FnInfo } from './members.ts'
import type { MemberTab } from './MemberPane.tsx'
import { useObjHits, type ParamClass } from './use-objcall.ts'

const NAME_OK = (n: string, list: GmObject[], self?: string) => !!n && (n === self || !list.some((o) => o.name === n))

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
export function useObjCallState(d: GmData, live: boolean) {
  const { project, target } = useUe()
  const { toast } = h()
  const [dialog, ask] = useAsk()
  const objects = d.gm.objects
  const [sel, setSel] = useKept<string>(`gm-obj/${project.id}`, '')
  const [tab, setTab] = useState<MemberTab>('fns')
  const [mode, setMode] = useState<CallMode>('call')
  const [fn, setFn] = useState<FnInfo>()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [many, setMany] = useState<GmMany>('error')
  const [picked, setPicked] = useState<string[]>([])
  const [out, setOut] = useState<CallOut>()
  const [sentArgs, setSentArgs] = useState<Record<string, unknown>>()
  const [running, setRunning] = useState(false)
  const [refEdit, setRefEdit] = useState<{ value?: GtRef; lockClass?: string; done: (ref: GtRef) => void }>()
  // 保存为 GM 弹窗：true 是存当前工作台的调用；from 是最近执行里一条自定义 GM 的那组参数（「存成 GM…」）
  const [saving, setSaving] = useState<false | true | { c: GmCustom; args: Record<string, unknown> }>(false)
  // 模块右键「在这个模块里新建 GM」记下的模块：下次保存为 GM 时默认选它
  const [saveModule, setSaveModule] = useState<string>()
  const { hits } = useObjHits(
    project.id,
    live,
    objects.map((o) => ({ name: o.name, o })),
  )
  const obj = objects.find((o) => o.name === sel) ?? objects[0]

  const save = (next: GmObject[]) => d.saveGm({ ...d.gm, objects: next })
  const askName = async (init: string, self?: string) => {
    const n = (
      await ask({ title: t('对象的名字'), label: t('在对象列表里叫什么（例如：商店界面、店主）'), init })
    )?.trim()
    if (!n) return undefined
    if (!NAME_OK(n, objects, self)) {
      toast.error(t('对象列表里已经有「{n}」了', { n }))
      return undefined
    }
    return n
  }
  const addObject = async (o: Omit<GmObject, 'name'>, init: string) => {
    const name = await askName(init)
    if (!name) return undefined
    await save([...objects, { name, ...o } as GmObject])
    setSel(name)
    return name
  }
  const pickFn = (f: FnInfo) => {
    setFn(f)
    setMode('call')
    setValues((v) => Object.fromEntries(f.params.map((p) => [p.name, v[p.name] ?? (p.obj ? undefined : '')])))
  }

  /** 这次调用的定义：参数按类型转好，空的普通参数不传（用函数的默认值） */
  const def = () => {
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
    return {
      kind: mode,
      obj: obj!.name,
      objects: objectsFor(objects, names),
      function: fn?.name,
      args,
      many,
      props: picked,
    }
  }
  const run = async () => {
    if (!obj) return
    const x = def()
    setRunning(true)
    setSentArgs(x.args)
    setOut(await runCall(project.id, x, x.args, target))
    setRunning(false)
  }

  const listProps = {
    objects,
    hits,
    live,
    selected: obj?.name ?? '',
    onPick: (n: string) => {
      if (n !== obj?.name) {
        setFn(undefined)
        setOut(undefined)
        setPicked([])
      }
      setSel(n)
    },
    onAdd: () =>
      setRefEdit({
        done: (ref) =>
          void addObject({ ref: ref as GmObject['ref'] }, ref.class.replace(/^.*[./]/, '').replace(/_C$/, '')),
      }),
    onAddSource: async (kind: 'pawn' | 'sub' | 'luaMod') => {
      if (kind === 'pawn') return void addObject({ src: '@pawn' }, t('玩家'))
      const label = kind === 'sub' ? t('子系统的类名（例如 UQuestSubsystem）') : t('Lua 模块名（require 的路径）')
      const v = (await ask({ title: kind === 'sub' ? t('加子系统') : t('加 Lua 模块'), label, init: '' }))?.trim()
      if (v) void addObject({ src: `@${kind}.${v}` }, v.split('.').pop() ?? v)
    },
    onEdit: (o: GmObject) =>
      setRefEdit({
        value: o.ref as GtRef,
        done: (ref) =>
          void save(objects.map((x) => (x.name === o.name ? { name: o.name, ref: ref as GmObject['ref'] } : x))),
      }),
    onRename: async (o: GmObject) => {
      const n = await askName(o.name, o.name)
      if (!n || n === o.name) return
      const favs = d.gm.favs.objcall.map((f) => (f.key === `obj:${o.name}` ? { key: `obj:${n}` } : f))
      await d.saveGm({
        ...d.gm,
        objects: objects.map((x) => (x.name === o.name ? { ...x, name: n } : x)),
        favs: { ...d.gm.favs, objcall: favs },
      })
      if (sel === o.name) setSel(n)
    },
    onCopy: async (o: GmObject) => {
      const { name: _n, by: _b, ...rest } = o
      await addObject(rest, t('{n} 副本', { n: o.name }))
    },
    onDelete: async (o: GmObject) => {
      const ok = await ask({ title: t('删除对象「{n}」？', { n: o.name }), okText: t('删除'), danger: true })
      if (ok === undefined) return
      await d.saveGm({
        ...d.gm,
        objects: objects.filter((x) => x.name !== o.name),
        favs: { ...d.gm.favs, objcall: d.gm.favs.objcall.filter((f) => f.key !== `obj:${o.name}`) },
      })
    },
    /** 对象右键「调函数」「取对象」：选上这个对象，右栏切过去，中栏跟着切到要用的那一页 */
    onCall: (n: string, m: CallMode) => {
      listProps.onPick(n)
      setMode(m)
      setTab(m === 'get' ? 'props' : 'fns')
    },
    isFav: (n: string) => d.gm.favs.objcall.some((f) => f.key === `obj:${n}`),
    onFav: (n: string) => void d.saveGm(toggleFav(d.gm, 'objcall', { key: `obj:${n}` })),
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
    const add = Object.entries(c.objects)
      .filter(([n]) => !objects.some((o) => o.name === n))
      .map(([name, o]) => ({ name, ...o }) as GmObject)
    if (add.length) await save([...objects, ...add])
    setSel(c.obj)
    setMode(c.kind)
    setMany(c.many)
    setPicked(c.props ?? [])
    setValues(c.args)
    setFn(
      c.function
        ? {
            name: c.function,
            sig: '',
            src: 'cpp',
            owner: '',
            params: Object.keys(c.args).map((n) => ({ name: n, type: '' })),
            callable: true,
          }
        : undefined,
    )
  }

  const dialogs = (
    <>
      {dialog}
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
      {saving && typeof saving === 'object' && (
        <SaveGmDialog
          init={{
            name: saving.c.name,
            note: saving.c.note,
            module: saving.c.module,
            editable: saving.c.editable,
          }}
          modules={allModules(d.gm, [])}
          obj={{ name: saving.c.obj, o: saving.c.objects[saving.c.obj] ?? {} }}
          fn={saving.c.kind === 'call' ? saving.c.function : undefined}
          args={saving.c.kind === 'call' ? saving.args : {}}
          props={saving.c.kind === 'get' ? saving.c.props : undefined}
          onClose={() => setSaving(false)}
          onSave={async (r) => {
            const c = saving.c
            try {
              // 对象从这条 GM 自己的副本里取（对象列表里可能已经改了、删了）
              const objs = Object.entries(c.objects).map(([name, o]) => ({ name, ...o }) as GmObject)
              const res = addCustom(d.gm, { ...c, objects: objs, args: saving.args }, r)
              await d.saveGm(res.g)
              setSaving(false)
              toast.success(t('已存成 GM「{n}」', { n: r.name }))
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
          props={mode === 'get' ? picked : undefined}
          onClose={() => setSaving(false)}
          onSave={async (r) => {
            try {
              const x = def()
              const res = addCustom(d.gm, { ...x, objects }, r)
              await d.saveGm(res.g)
              setSaving(false)
              toast.success(t('已存成 GM「{n}」', { n: r.name }))
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
    /** 模块右键「在这个模块里新建 GM」：之后保存为 GM 默认放进这个模块 */
    preferModule: (id: string) => setSaveModule(id),
    bench: {
      tab,
      setTab,
      mode,
      setMode,
      fn,
      pickFn,
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
      onNewRule,
      hits,
    },
  }
}

export type ObjCallState = ReturnType<typeof useObjCallState>
