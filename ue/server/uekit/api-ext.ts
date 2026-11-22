import { readFile } from 'node:fs/promises'
import type { OpCtx } from '../ops.ts'
import { BridgeError, liveCards } from '../instances.ts'
import type { InstallMode } from '../types.ts'
import { c, t } from '../util.ts'
import { remoteManifest } from '../uelink.ts'
import { extensionStatus } from './catalog.ts'
import { keyRulesAction, readKeyFields } from './gt-keys.ts'
import { tidyAction } from './gt-tidy.ts'
import { readAliases } from './gt-vars-file.ts'
import { luaGroup } from './gt-author/lua-vars.ts'
import { luaRoot } from './gt-author/lua-files.ts'
import { apiSettingsAction } from './gt-author/api-settings.ts'
import { libraryAction } from './gt-library/index.ts'
import { deleteShots, ocrScenario, shotsSize } from './gt-shots.ts'
import { insideProject, readEvidenceText, readReportFile, readScenario, scenarioAction } from './gt-files.ts'
import { expandGmText } from './gt-gm-expand.ts'
import { configBaseline } from './forge-baseline.ts'
import { forgeAssetExists, forgeReadConfig, forgeSaveConfig, forgeTemplates } from './forge-config-io.ts'
import { forgeCreateConfig, forgeEnsureRoot, forgeFileAction } from './forge-files.ts'
import { forgeWatch } from './forge-watch.ts'
import { extPaths } from './ext-paths.ts'
import { installExtension, uninstallExtension } from './install-ext.ts'
import { EXT_EVENT, watch } from './stream.ts'
import { upgradeAll, type UpgradePlan } from './upgrade-all.ts'

/**
 * UE 页「UE 插件」「AssetForge」「GameTest」用的接口（挂在 /api/plugins/ue/p/<项目>/ext/ 下）。
 * forge.* / gt.* 操作本身走通用的 POST op（ops.ts 按操作分权限、记操作记录），这里只放面板这边的事：
 * 插件目录和安装、推送事件登记、git 里上次提交的配置（属性差异的对比基线）、测试截图、GameTest 场景文件。
 */
type Body = Record<string, unknown>

/** 进程里实际加载的扩展版本：取第一个报了的进程（编辑器优先，liveCards 已按类型排好） */
async function loadedVersions(root: string) {
  const out = new Map<string, string>()
  for (const card of await liveCards(root))
    for (const e of card.extensions ?? []) if (!out.has(e.name)) out.set(e.name, e.version)
  return out
}

export async function extRoute(ctx: OpCtx, route: string, b: Body, url: URL): Promise<Response | Body | undefined> {
  const p = ctx.project
  switch (route) {
    case 'GET ext': {
      const refresh = url.searchParams.get('refresh') === '1'
      // 「检查更新」：插件目录和 UELink 的发布清单一起重读，UELink 卡片和概况页的「可升级」才跟得上
      if (refresh) await remoteManifest(true)
      return extensionStatus(p, await loadedVersions(p.root), refresh)
    }
    case 'POST ext/install': {
      const job = await installExtension(p, String(b.name), {
        version: b.version ? String(b.version) : undefined,
        mode: b.mode === 'vcs' || b.mode === 'local' ? (b.mode as InstallMode) : undefined,
      })
      return { job: job.id, ok: job.status === 'done' }
    }
    case 'POST ext/upgrade-all': {
      // 「全部升级」：网页把卡片上算好的升级计划传过来，服务端按依赖顺序串起来做（upgrade-all.ts）
      const plan = b as unknown as UpgradePlan
      const job = upgradeAll(p, {
        uelink: plan.uelink ? { prerelease: String(plan.uelink.prerelease ?? '') } : undefined,
        extensions: (Array.isArray(plan.extensions) ? plan.extensions : []).map((x) => ({
          name: String(x.name),
          version: x.version ? String(x.version) : undefined,
          mode: x.mode === 'vcs' || x.mode === 'local' ? x.mode : undefined,
        })),
        build: plan.build !== false,
        title: plan.title ? String(plan.title) : undefined,
      })
      return { job: job.id }
    }
    case 'POST ext/uninstall': {
      const job = await uninstallExtension(p, String(b.name))
      return { job: job.id, ok: job.status === 'done' }
    }
    case 'GET ext/paths':
      // 插件设置页的「目录」：配置根、场景根、产物目录实际在哪（ext-paths.ts）
      return extPaths(p.root)
    case 'POST ext/watch':
      return watch(p, String(b.conn ?? ''))
    case 'POST ext/baseline':
      // 属性差异「对比：上次提交的配置」（forge-baseline.ts）
      return configBaseline(p, String(b.file ?? ''))
    case 'POST ext/gt/scenario':
      // GameTest 页的步骤列表：场景文件里的每一步（没跑过的场景也要能看到）
      return { ...(await readScenario(p.root, String(b.root ?? ''), String(b.path ?? ''))) }
    case 'POST ext/gt/report':
      // gt.report 太长时 UE 写成文件只回路径：页面要每一步的结果，从这份文件取
      return readReportFile(p.root, String(b.file ?? ''))
    case 'POST ext/gt/text':
      // 步骤详情里展开失败证据的日志（log.txt）、控件快照（widgets.json）
      return readEvidenceText(p.root, String(b.file ?? ''))
    case 'POST ext/gt/file':
      // GameTest 页场景的右键菜单：改名、复制、删除、在文件夹中显示；步骤的「转成控件步骤」（replace）
      return scenarioAction(p.root, b, (text) => expandGmText(p, text))
    case 'POST ext/gt/luafields': {
      // 代码变量弹窗、对象标识的 Lua 组：游戏没开时扫界面绑的 Lua 文件（和 Agent 工具同一份 gt-author/lua-vars.ts）
      const g = await luaGroup(luaRoot(p), String(b.module ?? ''), '')
      return { module: String(b.module ?? ''), file: g?.file, items: g?.items ?? [] }
    }
    case 'POST ext/gt/aliases':
      // 条件里的「常用」：场景根 _vars.json 的常用名（gt-vars-file.ts）；save 时加一条
      return readAliases(p.root, String(b.root ?? ''), b)
    case 'POST ext/gt/library':
      // 场景库整理：文件夹（空的也列）、新建、拖动移动、改名、删除，移动时 call 路径跟着改（gt-library/）
      return libraryAction(p.root, b)
    case 'POST ext/gt/keyrules':
      // 条目规则面板：场景根 _settings.json 的 itemKeys（gt-keys.ts），编辑器没开也能改
      return keyRulesAction(p.root, b)
    case 'POST ext/gt/keyfields':
      // 「换一个标识」游戏没跑时：读录制时存下的条目全部字段（GameTest 1.6.0 的 hint.fields）
      return readKeyFields(p.root, String(b.file ?? ''))
    case 'POST ext/gt/tidy':
      // 「AI 整理」：整理稿的路径、差异、保存（原场景备份成 .json.bak）、放弃、恢复原录制（gt-tidy.ts）
      return tidyAction(p.root, b)
    case 'POST ext/gt/api':
      // 设置页「接口库」：_settings.json 的 api.lua / api.cpp 文件夹，存完重扫 Lua 接口写 _api.json；
      // action=file 原样读 _api.json（编辑页、接口库弹窗编辑器没开时列项目接口）（gt-author/api-settings.ts）
      return apiSettingsAction(p, b)
    case 'POST ext/gt/ocr':
      // 录完停止后、或步骤列表「识别截图文字」：给截图补 hint.ocr（gt-shots.ts）
      return ocrScenario(p.root, b)
    case 'POST ext/gt/shots':
      // 删除录制截图：一个场景的或全部；action=size 只看占用
      return b.action === 'size' ? shotsSize(p.root) : deleteShots(p.root, b)
    case 'POST ext/forge/file':
      // AssetForge 页的右键菜单：在文件夹中显示、用编辑器打开（只认配置根里的）
      return forgeFileAction(p.root, b)
    case 'POST ext/forge/root':
      // 打开 AssetForge 页时配置根还不存在：直接建出来
      return forgeEnsureRoot(p.root, b)
    case 'POST ext/forge/create':
      // 「新建配置」：模板生成的 JSON 写进配置根；让 AI 写时先建好目录
      return forgeCreateConfig(p.root, b)
    case 'POST ext/forge/read':
      // 「配置原文」页签编辑、复制一份、存为模板：读整份原文（describe 回的原文超长会截断）
      return forgeReadConfig(p.root, b)
    case 'POST ext/forge/save':
      // 「配置原文」页签保存：带读出时的修改时间，中间被改过就拒绝
      return forgeSaveConfig(p.root, b)
    case 'POST ext/forge/templates':
      // 新建配置弹窗里的「项目模板」：配置根下 _templates/ 里的 JSON
      return forgeTemplates(p.root, b)
    case 'POST ext/forge/asset':
      // 新建配置前看目标资产在不在磁盘上
      return forgeAssetExists(p.root, b)
    case 'POST ext/forge/watch':
      // AssetForge 页右栏选中的配置：存盘了推 forge.file，页面重拉差异、重新演练（不轮询）
      if (!b.root) throw new BridgeError(t('不知道配置根在哪：先刷新 AssetForge 页'))
      return forgeWatch(p.id, insideProject(p.root, String(b.root)), b, (data, conn) =>
        c().pages.push(EXT_EVENT, data, conn),
      )
    case 'GET ext/file': {
      // GameTest 的截图（Saved/GameTest/... 下的 png）：页面上看步骤截图用
      const rel = url.searchParams.get('path') ?? ''
      const file = insideProject(p.root, rel)
      if (!/\.(png|jpe?g)$/i.test(file)) throw new Error(t('只能看图片'))
      const buf = await readFile(file).catch(() => undefined)
      if (!buf) return new Response(t('文件不存在：{p}', { p: rel }), { status: 404 })
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store' },
      })
    }
    default:
      return undefined
  }
}
