import { CircleDot, Copy, FilePlus, FolderOpen, FolderPlus, Layers, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '../../menu.tsx'
import type { Scenario } from './GtMenus.tsx'
import { DeleteDialog, MoveDialog, NameDialog } from './GtLibraryDialogs.tsx'
import { dirOf, followMove, libOp, type DeletePlan, type MoveDone, type MovePlan } from './gt-library.ts'
import type { DragSrc } from './tree-dnd.ts'
import { nameTaken } from './gt-names.ts'

/**
 * GameTest 场景库的整理（设计稿 12.1）：文件夹（空的也显示）、标题栏「新建」下拉、文件夹右键菜单、
 * 脚本和文件夹的拖动移动、改名、删除。移动或改名前先列出要跟着改的 call 路径，确认后一起改（没有要改的直接挪）；
 * 删除前列出会删哪些、谁还在 call 它们。全部直接读写磁盘（服务端 gt-library/），UE 没连着也能整理。
 * 「新建」建在选中的文件夹里：点过的文件夹，没点过时是选中脚本所在的文件夹，都没有就是场景根。
 */

interface Naming {
  title: string
  okText: string
  initial?: string
  placeholder?: string
  note?: ReactNode
  validate?: (name: string) => string | undefined
  run: (name: string) => void
}

export function useScenarioLibrary(o: {
  project: string
  /** 场景根的绝对路径和给人看的写法 */
  root: string
  rootLabel: string
  scenarios: Scenario[]
  /** 选中的场景（相对场景根，带 .json） */
  selected?: string
  reload: () => void
  /** 打开一个场景；undefined 是取消选中（选中的被删了） */
  open: (path?: string) => void
  /** 录制要编辑器：没连上时为空，菜单里的「录制」置灰 */
  recordIn?: (dir: string) => void
  /** 「让 Agent 写」（定稿 11.1，gt-author/GtAgentWrite.tsx）：在这个文件夹里写一份测试 */
  agentWriteIn?: (dir: string) => void
  /** 批量运行（文件夹右键「运行这里的全部场景」）；正在跑时 locked */
  runBatch?: (paths: string[], label: string) => void
  locked: boolean
}) {
  const { toast } = h()
  const [folders, setFolders] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string>()
  const [naming, setNaming] = useState<Naming>()
  const [moving, setMoving] = useState<{ plan: MovePlan; args: Record<string, unknown> }>()
  const [deleting, setDeleting] = useState<DeletePlan>()

  const fail = (e: unknown) => toast.error((e as Error).message)
  const refreshFolders = () => {
    if (!o.root) return
    libOp<{ folders: string[] }>(o.project, o.root, 'list')
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]))
  }
  // 场景列表重拉了（录完、Agent 写了、别处改了）就跟着重读文件夹；列表本身每次 reload 都是新数组
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshFolders, [o.project, o.root, o.scenarios])
  const after = () => {
    o.reload()
    refreshFolders()
  }

  /** 新建的东西放哪：选中的文件夹 > 选中脚本所在的文件夹 > 根 */
  const newDir = activeFolder ?? (o.selected ? dirOf(o.selected) : '')
  const where = (dir: string) => (dir ? t('建在 {p}', { p: dir }) : t('建在场景根'))

  const newFolder = (dir: string) =>
    setNaming({
      title: t('新建文件夹'),
      okText: t('新建'),
      placeholder: t('文件夹名，例如 common'),
      note: where(dir),
      run: (name) =>
        void libOp<{ path: string }>(o.project, o.root, 'mkdir', { dir, name })
          .then((r) => {
            setActiveFolder(r.path)
            after()
          })
          .catch(fail),
    })
  const newScript = (dir: string) =>
    setNaming({
      title: t('新建脚本'),
      okText: t('新建'),
      placeholder: t('脚本名，例如 每日福利'),
      note: t('{where}。先放一步「等 1 秒」占位，打开后在步骤列表里插入真正的步骤。', { where: where(dir) }),
      validate: (name) => nameTaken(o.scenarios, name),
      run: (name) =>
        void libOp<{ path: string }>(o.project, o.root, 'create', { dir, name })
          .then((r) => {
            after()
            setActiveFolder(undefined)
            o.open(r.path)
          })
          .catch(fail),
    })

  /** 真挪：挪完重拉，选中的场景、文件夹跟着换成新路径 */
  const doMove = async (plan: MovePlan, args: Record<string, unknown>) => {
    try {
      const r = await libOp<MoveDone>(o.project, o.root, 'move', { path: plan.path, ...args })
      toast.success(
        r.refs ? t('已移到 {p}，改了 {n} 处 call', { p: r.path, n: r.refs }) : t('已移到 {p}', { p: r.path }),
      )
      after()
      const sel = followMove(o.selected, plan.path, r.path, plan.dir)
      if (sel) o.open(sel)
      // 选中的文件夹就是挪走的这个、或在它下面：跟着换路径
      if (plan.dir && activeFolder !== undefined) {
        if (activeFolder.toLowerCase() === plan.path.toLowerCase()) setActiveFolder(r.path)
        else {
          const f = followMove(activeFolder, plan.path, r.path, true)
          if (f) setActiveFolder(f)
        }
      }
    } catch (e) {
      fail(e)
    }
  }
  /** 移动或改名：先看要跟着改的 call，有就弹窗确认，没有直接挪 */
  const move = async (path: string, args: { toDir?: string; name?: string }) => {
    try {
      const plan = await libOp<MovePlan>(o.project, o.root, 'movePlan', { path, ...args })
      if (plan.same) return
      if (plan.refs.length) setMoving({ plan, args })
      else await doMove(plan, args)
    } catch (e) {
      fail(e)
    }
  }
  /** 录完的场景挪进要的文件夹（刚录的不会有人 call，不用确认）；返回新路径，失败留在 recorded/ 并提示 */
  const moveTo = async (path: string, toDir: string) => {
    if (dirOf(path) === toDir) return path
    try {
      const r = await libOp<MoveDone>(o.project, o.root, 'move', { path, toDir })
      after()
      return r.path
    } catch (e) {
      fail(e)
      return path
    }
  }
  const askRemove = (path: string) =>
    void libOp<DeletePlan>(o.project, o.root, 'deletePlan', { path }).then(setDeleting).catch(fail)
  const remove = async () => {
    const plan = deleting
    setDeleting(undefined)
    if (!plan) return
    try {
      await libOp(o.project, o.root, 'delete', { path: plan.path })
      toast.success(t('已删除 {p}', { p: plan.path }))
      if (followMove(o.selected, plan.path, plan.path, plan.dir)) o.open(undefined)
      if (activeFolder && (activeFolder === plan.path || activeFolder.startsWith(`${plan.path}/`)))
        setActiveFolder(undefined)
      after()
    } catch (e) {
      fail(e)
    }
  }
  const rename = (path: string, initial: string, dir: boolean) =>
    setNaming({
      title: dir ? t('文件夹改名') : t('改名'),
      okText: t('改名'),
      initial,
      note: dir
        ? t('有别的脚本 call 这个文件夹里的脚本时，先列出要跟着改的路径，确认后一起改。')
        : t('文件名和场景里的名字一起改，文件留在原来的文件夹；有别的脚本 call 它时先列出来，确认后一起改。'),
      // 脚本不许同名；文件夹不管
      validate: dir ? undefined : (name) => nameTaken(o.scenarios, name, path),
      run: (name) => void move(path, { name }),
    })
  const reveal = (path: string) =>
    void ppost(o.project, 'ext/gt/file', { root: o.root, path, action: 'reveal' }).catch(fail)
  const fullPath = (rel: string) => `${o.root.replace(/[\\/]+$/, '')}/${rel}`

  /** 「新建」的几项：建在 dir 里（标题栏的建在选中的文件夹，空白处右键的建在场景根） */
  const createItems = (dir: string) => [
    { label: t('新建脚本（编写）…'), icon: FilePlus, onClick: () => newScript(dir) },
    {
      label: t('新建脚本（录制）…'),
      icon: CircleDot,
      hint: o.recordIn ? undefined : t('要先启动编辑器'),
      disabled: !o.recordIn || o.locked,
      onClick: () => o.recordIn?.(dir),
    },
    o.agentWriteIn && { label: t('让 Agent 写…'), icon: Sparkles, onClick: () => o.agentWriteIn?.(dir) },
    'sep' as const,
    { label: t('新建文件夹…'), icon: FolderPlus, onClick: () => newFolder(dir) },
  ]

  /** 标题栏「新建」 */
  const newMenu = (e: MouseEvent) => openMenu(e, [{ title: where(newDir) }, ...createItems(newDir)])

  /** 场景列表空白处右键：在场景根新建，以及场景根的路径操作（行上的右键各有自己的菜单，不会冒泡到这里） */
  const blankMenu = (e: MouseEvent) => {
    if (!o.root) return e.preventDefault()
    openMenu(e, [
      { title: t('场景根') },
      ...createItems(''),
      'sep',
      { label: t('复制完整路径'), icon: Copy, onClick: () => copyText(o.root) },
      { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => reveal('') },
    ])
  }

  const folderMenu = (e: MouseEvent, path: string, leaves: Scenario[]) => {
    const runnable = leaves.filter((s) => !s.parseError)
    openMenu(e, [
      { title: t('{p}（{n} 个场景）', { p: path, n: leaves.length }) },
      { label: t('新建子文件夹…'), icon: FolderPlus, onClick: () => newFolder(path) },
      { label: t('在这里新建脚本…'), icon: FilePlus, onClick: () => newScript(path) },
      {
        label: t('在这里录制…'),
        icon: CircleDot,
        hint: o.recordIn ? undefined : t('要先启动编辑器'),
        disabled: !o.recordIn || o.locked,
        onClick: () => o.recordIn?.(path),
      },
      o.agentWriteIn && { label: t('在这里让 Agent 写…'), icon: Sparkles, onClick: () => o.agentWriteIn?.(path) },
      o.runBatch && 'sep',
      o.runBatch && {
        label: t('运行这里的全部场景'),
        icon: Layers,
        hint: t('一个接一个'),
        disabled: o.locked || !runnable.length,
        onClick: () =>
          o.runBatch!(
            runnable.map((s) => s.relativePath),
            path,
          ),
      },
      'sep',
      { label: t('改名…'), icon: Pencil, onClick: () => rename(path, path.split('/').at(-1) ?? path, true) },
      { label: t('复制路径'), icon: Copy, hint: t('相对场景根'), onClick: () => copyText(path) },
      { label: t('复制完整路径'), icon: Copy, onClick: () => copyText(fullPath(path)) },
      { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => reveal(path) },
      'sep',
      { label: t('删除…'), icon: Trash2, danger: true, onClick: () => askRemove(path) },
    ])
  }

  /** 拖动放下：叶子按场景文件的路径挪，文件夹按目录挪 */
  const onMove = (src: DragSrc<Scenario>, toDir: string) =>
    void move(src.dir ? src.path : (src.data?.relativePath ?? `${src.path}.json`), { toDir })

  const dialogs = (
    <>
      <NameDialog
        open={!!naming}
        title={naming?.title ?? ''}
        okText={naming?.okText ?? ''}
        initial={naming?.initial}
        placeholder={naming?.placeholder}
        note={naming?.note}
        validate={naming?.validate}
        onOk={(name) => {
          const run = naming?.run
          setNaming(undefined)
          run?.(name)
        }}
        onCancel={() => setNaming(undefined)}
      />
      <MoveDialog
        plan={moving?.plan}
        onOk={() => {
          const m = moving
          setMoving(undefined)
          if (m) void doMove(m.plan, m.args)
        }}
        onCancel={() => setMoving(undefined)}
      />
      <DeleteDialog
        plan={deleting}
        rootLabel={o.rootLabel}
        onOk={() => void remove()}
        onCancel={() => setDeleting(undefined)}
      />
    </>
  )

  return {
    folders,
    activeFolder,
    setActiveFolder,
    newMenu,
    blankMenu,
    folderMenu,
    onMove,
    moveTo,
    /** 脚本右键的改名 / 删除（GtMenus.tsx）：同样先看 call */
    renameScenario: (s: Scenario) => rename(s.relativePath, s.name, false),
    removeScenario: (s: Scenario) => askRemove(s.relativePath),
    dialogs,
  }
}

export type ScenarioLibrary = ReturnType<typeof useScenarioLibrary>
