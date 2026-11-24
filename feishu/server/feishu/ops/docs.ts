import { t } from '../../../shared/i18n.ts'
import { brief, diffOf, list, num, opt, raw, str } from './args.ts'
import type { OpDef } from './types.ts'

/** 文档（新版 docx 和旧版 doc，wiki 链接解开后是它们）和评论 */

const DOC = { arg: 'doc', kind: 'docx' as const, accept: ['docx', 'doc'] }

/** docs +update 的 command 给人看的说法 */
const UPDATE_LABEL: Record<string, () => string> = {
  str_replace: () => t('替换文字'),
  block_insert_after: () => t('在块后插入'),
  block_replace: () => t('替换块'),
  block_delete: () => t('删除块'),
  block_copy_insert_after: () => t('复制块'),
  block_move_after: () => t('移动块'),
  overwrite: () => t('整篇覆盖'),
  append: () => t('追加到末尾'),
}

export const DOC_OPS: OpDef[] = [
  {
    tool: 'feishu_doc',
    action: 'fetch',
    level: 'read',
    target: DOC,
    label: () => t('读取文档'),
    output: 'doc',
    cli: (a, x) => {
      const out = ['docs', '+fetch', '--doc', x!.url]
      opt(out, 'scope', str(a, 'scope'))
      opt(out, 'detail', str(a, 'detail'))
      opt(out, 'doc-format', str(a, 'format'))
      opt(out, 'keyword', str(a, 'keyword'))
      opt(out, 'start-block-id', str(a, 'start_block_id'))
      opt(out, 'end-block-id', str(a, 'end_block_id'))
      opt(out, 'max-depth', num(a, 'max_depth'))
      opt(out, 'context-before', num(a, 'context_before'))
      opt(out, 'context-after', num(a, 'context_after'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_doc',
    action: 'links',
    level: 'read',
    target: DOC,
    label: () => t('列出文档里的引用链接'),
    output: 'json',
    local: 'links',
    cli: (_a, x) => ({ args: ['docs', '+fetch', '--doc', x!.url, '--detail', 'simple'] }),
  },
  {
    tool: 'feishu_doc',
    action: 'update',
    level: 'write',
    target: DOC,
    label: () => t('修改文档'),
    output: 'json',
    summary: (a) => {
      const how = UPDATE_LABEL[str(a, 'command')]?.() ?? str(a, 'command')
      const where = str(a, 'block_id') || [str(a, 'start_block_id'), str(a, 'end_block_id')].filter(Boolean).join(' ~ ')
      return [t('操作：{how}', { how }), where ? t('位置：{where}', { where }) : ''].filter(Boolean).join('\n')
    },
    diff: (a) => diffOf(t('文档'), raw(a, 'pattern'), raw(a, 'content')),
    cli: (a, x) => {
      const out = ['docs', '+update', '--doc', x!.url, '--command', str(a, 'command')]
      opt(out, 'doc-format', str(a, 'format'))
      opt(out, 'pattern', str(a, 'pattern'))
      opt(out, 'block-id', str(a, 'block_id'))
      opt(out, 'start-block-id', str(a, 'start_block_id'))
      opt(out, 'end-block-id', str(a, 'end_block_id'))
      opt(out, 'src-block-ids', list(a, 'src_block_ids').join(','))
      opt(out, 'revision-id', num(a, 'revision_id'))
      const content = raw(a, 'content')
      if (content) out.push('--content', '-')
      return { args: out, stdin: content || undefined }
    },
  },
  {
    tool: 'feishu_doc',
    action: 'create',
    level: 'write',
    target: { arg: 'parent', kind: 'folder', accept: ['folder', 'wiki', 'docx'], optional: true },
    label: () => t('新建文档'),
    output: 'json',
    creates: true,
    summary: (a) =>
      [
        t('标题：{title}', { title: str(a, 'title') || t('（未命名）') }),
        str(a, 'parent') ? '' : t('位置：我的文档库'),
        brief(raw(a, 'content')),
      ]
        .filter(Boolean)
        .join('\n'),
    cli: (a, x) => {
      const out = ['docs', '+create']
      opt(out, 'title', str(a, 'title'))
      opt(out, 'doc-format', str(a, 'format'))
      if (x) opt(out, 'parent-token', x.token)
      else out.push('--parent-position', 'my_library')
      const content = raw(a, 'content')
      if (content) out.push('--content', '-')
      return { args: out, stdin: content || undefined }
    },
  },
  {
    tool: 'feishu_doc',
    action: 'media',
    level: 'read',
    target: DOC,
    label: () => t('下载文档里的图片或附件'),
    output: 'json',
    // --output 由执行器换成这个对话的缓存目录里的文件（见 run-op.ts），Agent 给的路径不用
    cli: (a) => ({ args: ['docs', '+media-download', '--token', str(a, 'media_token'), '--output', '{out}'] }),
  },
  {
    tool: 'feishu_comment',
    action: 'list',
    level: 'read',
    target: { ...DOC, accept: ['docx', 'doc', 'sheet', 'bitable', 'slides', 'file'] },
    label: () => t('读取评论'),
    output: 'json',
    cli: (a, x) => {
      const out = ['drive', '+list-comments', '--url', x!.url]
      opt(out, 'solved-status', str(a, 'solved') || 'false')
      opt(out, 'page-size', num(a, 'limit'))
      opt(out, 'page-token', str(a, 'page_token'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_comment',
    action: 'add',
    level: 'write',
    target: { ...DOC, accept: ['docx', 'doc', 'sheet', 'bitable', 'slides', 'file'] },
    label: () => t('添加评论'),
    output: 'json',
    summary: (a) => brief(raw(a, 'text')),
    cli: (a, x) => {
      const out = ['drive', '+add-comment', '--doc', x!.url, '--content', '-']
      if (str(a, 'block_id')) opt(out, 'block-id', str(a, 'block_id'))
      else out.push('--full-comment')
      return { args: out, stdin: JSON.stringify([{ type: 'text', text: raw(a, 'text') }]) }
    },
  },
  {
    tool: 'feishu_comment',
    action: 'reply',
    level: 'write',
    target: { ...DOC, accept: ['docx', 'doc', 'sheet', 'bitable', 'slides', 'file'] },
    label: () => t('回复评论'),
    output: 'json',
    summary: (a) => brief(raw(a, 'text')),
    cli: (a, x) => ({
      args: ['drive', '+add-reply', '--url', x!.url, '--comment-id', str(a, 'comment_id'), '--content', '-'],
      stdin: JSON.stringify([{ type: 'text', text: raw(a, 'text') }]),
    }),
  },
  {
    tool: 'feishu_comment',
    action: 'resolve',
    level: 'write',
    target: { ...DOC, accept: ['docx', 'doc', 'sheet', 'bitable', 'slides', 'file'] },
    label: () => t('标记评论已解决'),
    output: 'json',
    summary: (a) => t('评论：{id}', { id: str(a, 'comment_id') }),
    cli: (a, x) => ({ args: ['drive', '+resolve-comment', '--url', x!.url, '--comment-id', str(a, 'comment_id')] }),
  },
]
