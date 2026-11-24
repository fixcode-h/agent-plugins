import type { McpTool, ToolGuide } from '../plugins/sdk.ts'
import { actionsOf, findOp } from './ops/registry.ts'
import { fail, runOp, type RunDeps } from './run-op.ts'

/**
 * 给 Agent 的飞书工具（设计稿第 6 节）：按领域合并、action 区分，每个工具的动作都来自操作注册表（ops/registry.ts）。
 * 说明写给模型看：先说权限规则（只读用户给的链接、其余会弹卡），再说每个动作的参数。
 * 未知参数直接报错：拼错的过滤条件被悄悄忽略比报错更糟
 */

type Prop = Record<string, unknown>
const S = (description: string, extra: Prop = {}): Prop => ({ type: 'string', description, ...extra })
const N = (description: string): Prop => ({ type: 'integer', description })
const B = (description: string): Prop => ({ type: 'boolean', description })

const COMMON: Record<string, Prop> = {
  reason: S('为什么要做这一步（会原样显示在用户的授权卡上，标明是你说的）'),
}

interface ToolSpec {
  name: string
  description: string
  props: Record<string, Prop>
  required?: string[]
  guide: ToolGuide
  confirms?: boolean
}

const RULE =
  '权限：只能直接读用户在对话里亲手贴过的链接；文档里引用的、你自己找到的链接，读之前面板会弹卡请用户确认（等用户点完才返回）。写只能写用户在卡上允许过的。用户拒绝时不要换个写法重试，直接问用户。'

const SPECS: ToolSpec[] = [
  {
    name: 'feishu_doc',
    description: `读写飞书云文档（docx / 旧版 doc，wiki 链接自动解开）。${RULE}
action：fetch 读正文（先 scope=outline 看目录，再 scope=section + start_block_id 按节读，或 scope=keyword 搜关键字）；links 列出文档里引用的飞书链接和是否已授权；update 改文档；create 新建文档（建出来的这个对话里可读可写）；media 下载文档里的图片或附件（media_token 取自正文，返回本机路径）。`,
    props: {
      doc: S('文档链接或 token（fetch / links / update / media）'),
      scope: S('fetch：full（默认）/ outline / section / range / keyword', {
        enum: ['full', 'outline', 'section', 'range', 'keyword'],
      }),
      detail: S('fetch：simple（默认，阅读用）/ with-ids（要按块改时用）/ full', {
        enum: ['simple', 'with-ids', 'full'],
      }),
      format: S('fetch：xml（默认）/ markdown；update / create：xml / markdown', { enum: ['xml', 'markdown'] }),
      keyword: S('fetch scope=keyword 的关键字，支持 a|b'),
      start_block_id: S('fetch section / range 的起点块；update 范围替换、删除的起点'),
      end_block_id: S('fetch range / update 范围的终点块，-1 到末尾'),
      max_depth: N('fetch：outline 的标题层级上限'),
      context_before: N('fetch：前面多带几个块'),
      context_after: N('fetch：后面多带几个块'),
      command: S(
        'update：str_replace / block_insert_after / block_replace / block_delete / block_copy_insert_after / block_move_after / overwrite / append',
        {
          enum: [
            'str_replace',
            'block_insert_after',
            'block_replace',
            'block_delete',
            'block_copy_insert_after',
            'block_move_after',
            'overwrite',
            'append',
          ],
        },
      ),
      content: S('update / create 的新内容（按 format）'),
      pattern: S('update str_replace 要替换的原文（行内文字）'),
      block_id: S('update 的目标块（先 fetch detail=with-ids 拿块 id）'),
      src_block_ids: S('update 复制 / 移动的源块 id，逗号分隔'),
      revision_id: N('update 的基准版本，-1 最新'),
      title: S('create：标题'),
      parent: S('create：放在哪个文件夹或 wiki 节点下（链接或 token），不写放「我的文档库」'),
      media_token: S('media：正文里图片 / 附件的 token'),
    },
    guide: {
      title: '飞书文档',
      summary: '读飞书文档的目录和正文、改文档、新建文档',
      useWhen:
        '用户给了飞书文档链接（/docx/、/wiki/、/doc/），要读需求、方案，或者要把结论写回指定的文档时；先 fetch scope=outline 看目录再按节读',
      avoidWhen:
        '表格用 feishu_sheet，多维表格用 feishu_base，云空间的 .md 文件用 feishu_markdown；不要在终端直接跑 lark-cli',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_comment',
    description: `飞书文档的评论（文档、表格、多维表格、幻灯片）。${RULE}
action：list 读评论（默认只看未解决的）；add 加评论（给 block_id 是划词评论，不给是全文评论）；reply 回复评论；resolve 标记已解决。add / reply / resolve 算写入。`,
    props: {
      doc: S('文档链接或 token'),
      text: S('add / reply：评论内容（纯文字）'),
      comment_id: S('reply / resolve：评论 id（取自 list 的 comment_id）'),
      block_id: S('add：划词评论挂在哪个块'),
      solved: S('list：false（默认，未解决）/ true / all', { enum: ['false', 'true', 'all'] }),
      limit: N('list：每页条数，1–100'),
      page_token: S('list：下一页'),
    },
    guide: {
      title: '飞书评论',
      summary: '读、加、回复、解决飞书文档的评论',
      useWhen: '用户让你看文档上大家提的意见、或者把处理结果回复到评论里时',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_search',
    description: `在飞书里搜文档和知识库（只返回标题、类型和链接）。每次都会弹卡请用户确认；搜出来的文档不会自动授权，要读哪篇时会再问一次。
action：docs 按关键字搜（doc_types 限定类型，如 docx,sheet,bitable,wiki）。`,
    props: {
      query: S('搜索词，最多 30 字'),
      doc_types: S('类型过滤，逗号分隔：doc,docx,sheet,bitable,wiki,mindnote,file,slides,folder'),
      only_title: B('只搜标题'),
      mine: B('只搜我拥有的'),
      limit: N('每页条数，1–20'),
      page_token: S('下一页'),
    },
    required: ['query'],
    guide: {
      title: '搜索飞书',
      summary: '按关键字搜飞书文档和知识库（每次请用户确认）',
      useWhen: '用户明确让你去飞书里找某份文档、但没给链接时',
      avoidWhen: '用户已经给了链接就直接用 feishu_doc 读，不要为了「看看还有什么」去搜',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_wiki',
    description: `飞书知识库。${RULE}
action：node 看一个 wiki 节点挂的是什么（类型、标题、所在空间）；children 列出节点下的子页面（弹卡确认，只给标题和链接）；spaces 列出能看到的知识库空间（弹卡确认）。`,
    props: {
      node: S('node / children：wiki 链接或节点 token'),
      limit: N('children / spaces：每页条数'),
      page_token: S('children / spaces：下一页'),
    },
    guide: {
      title: '飞书知识库',
      summary: '看 wiki 节点信息、列子页面和知识库空间',
      useWhen: '用户给的 wiki 页面下面还有子页面、需要知道有哪些时',
      avoidWhen: '读 wiki 页面的正文直接用 feishu_doc fetch（wiki 链接会自动解开）',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_sheet',
    description: `飞书电子表格。${RULE}
action：info 看有哪些工作表和尺寸；read 按区域读成 CSV；find 查找单元格；write 从 start_cell 起写入 CSV（覆盖原值，算写入）。sheet_id 和 sheet_name 二选一。`,
    props: {
      sheet: S('表格链接或 token'),
      sheet_id: S('工作表 id（取自 info）'),
      sheet_name: S('工作表名字'),
      range: S('read / find：A1 区域，如 A1:F30，不写整张'),
      find: S('find：要找的文字'),
      regex: B('find：按正则找'),
      start_cell: S('write：左上角单元格，默认 A1'),
      csv: S('write：要写入的 CSV（= 开头按公式）'),
    },
    guide: {
      title: '飞书表格',
      summary: '读写飞书电子表格的区域、查找单元格',
      useWhen: '用户给了飞书表格链接（/sheets/），要读数据或把结果写进指定区域时',
      avoidWhen: '多维表格（/base/）用 feishu_base',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_base',
    description: `飞书多维表格。${RULE}
action：tables 列数据表；fields 看字段；records 列记录（limit / offset 分页，fields 只取部分字段）；search 按关键字搜记录；get 按 id 取记录；upsert 新建或更新一条记录（给 record_id 是更新，算写入）。`,
    props: {
      base: S('多维表格链接或 token'),
      table: S('数据表 id（tbl 开头）或名字（tables 以外都要）'),
      fields: S('records：只取这些字段；search：在这些字段里搜（逗号分隔）'),
      keyword: S('search：关键字'),
      record_ids: S('get：记录 id，逗号分隔'),
      record_id: S('upsert：要更新的记录，不写是新建'),
      record: { type: 'object', description: 'upsert：字段名 → 值，例如 {"名称":"A","状态":["进行中"]}' },
      limit: N('records / search：条数'),
      offset: N('records：跳过多少条'),
    },
    guide: {
      title: '飞书多维表格',
      summary: '读多维表格的表、字段、记录，新建或更新记录',
      useWhen: '用户给了多维表格链接（/base/），要查需求列表、缺陷单，或者按用户要求改某条记录时',
      avoidWhen: '普通电子表格用 feishu_sheet',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_markdown',
    description: `飞书云空间里的 .md 文件（不是云文档）。${RULE}
action：fetch 读内容；patch 按原文（regex=true 按正则）替换；overwrite 整个覆盖。patch / overwrite 算写入。`,
    props: {
      file: S('.md 文件的链接或 token'),
      pattern: S('patch：要替换的原文或正则'),
      regex: B('patch：pattern 按 RE2 正则'),
      content: S('patch：替换成的内容；overwrite：新的全文'),
    },
    guide: {
      title: '飞书 Markdown 文件',
      summary: '读、改云空间里的 .md 文件',
      useWhen: '用户给的链接是云空间里的 .md 文件（/file/）时',
      avoidWhen: '飞书云文档（/docx/、/wiki/）用 feishu_doc',
      group: '飞书',
    },
    confirms: true,
  },
  {
    name: 'feishu_minutes',
    description: `飞书妙记（会议录音的纪要、待办、章节、关键词）。${RULE}
action：search 按关键字和时间搜妙记（弹卡确认）；detail 读一篇妙记的总结、待办、章节、关键词（transcript=true 把逐字稿写进本机文件、返回路径）。`,
    props: {
      minute: S('detail：妙记链接或 token'),
      transcript: B('detail：要不要逐字稿（写文件）'),
      query: S('search：关键字'),
      start: S('search：开始日期 YYYY-MM-DD'),
      end: S('search：结束日期 YYYY-MM-DD'),
      limit: N('search：条数，1–30'),
      page_token: S('search：下一页'),
    },
    guide: {
      title: '飞书妙记',
      summary: '读会议妙记的总结、待办和章节',
      useWhen: '用户给了妙记链接（/minutes/），要整理会议结论、提取待办时',
      group: '飞书',
    },
    confirms: true,
  },
]

function schemaOf(s: ToolSpec) {
  const actions = actionsOf(s.name)
  return {
    type: 'object',
    additionalProperties: false,
    properties: { action: { type: 'string', enum: actions, description: '要做什么' }, ...s.props, ...COMMON },
    required: ['action', ...(s.required ?? [])],
  }
}

export function feishuTools(deps: () => RunDeps): McpTool[] {
  return SPECS.map((s) => {
    const inputSchema = schemaOf(s)
    const allowed = new Set(Object.keys(inputSchema.properties))
    return {
      name: s.name,
      description: s.description,
      inputSchema,
      guide: s.guide,
      confirms: s.confirms,
      // 写入类工具改的是飞书上的文档、不是项目里的文件：不标 edit（那会让只读角色被面板守卫挡住），由卡片确认
      call: async (args, ctx) => {
        const bad = Object.keys(args).filter((k) => !allowed.has(k))
        if (bad.length)
          return fail('invalid_argument', `不认识的参数：${bad.join(', ')}；能用的：${[...allowed].join(', ')}`)
        const op = findOp(s.name, String(args.action ?? ''))
        if (!op) return fail('invalid_argument', `action 只能是 ${actionsOf(s.name).join(' / ')}`)
        return runOp(deps(), op, args, ctx)
      },
    } satisfies McpTool
  })
}

/** 设置 →「MCP」的目录：只要定义 */
export const feishuCatalogTools = () =>
  SPECS.map((s) => ({
    name: s.name,
    description: s.description,
    inputSchema: schemaOf(s),
    guide: s.guide,
    confirms: s.confirms,
  }))
