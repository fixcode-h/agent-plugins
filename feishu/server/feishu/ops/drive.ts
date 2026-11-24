import { t } from '../../../shared/i18n.ts'
import { list, num, opt, str } from './args.ts'
import type { OpDef } from './types.ts'

/** 搜索、知识库、妙记搜索：都是看不出会碰到哪篇文档的「发现类」操作，每次弹卡 */

export const DRIVE_OPS: OpDef[] = [
  {
    tool: 'feishu_search',
    action: 'docs',
    level: 'discover',
    label: () => t('搜索飞书文档'),
    output: 'list',
    summary: (a) =>
      [
        t('搜索词：{q}', { q: str(a, 'query') || t('（空，按条件列出）') }),
        list(a, 'doc_types').length ? t('类型：{types}', { types: list(a, 'doc_types').join(', ') }) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    cli: (a) => {
      const out = ['drive', '+search', '--query', str(a, 'query')]
      opt(out, 'doc-types', list(a, 'doc_types').join(','))
      if (a.only_title === true) out.push('--only-title')
      if (a.mine === true) out.push('--mine')
      opt(out, 'page-size', num(a, 'limit'))
      opt(out, 'page-token', str(a, 'page_token'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_wiki',
    action: 'node',
    level: 'read',
    target: { arg: 'node', kind: 'wiki', accept: ['docx', 'doc', 'sheet', 'bitable', 'slides', 'file', 'mindnote'] },
    label: () => t('读取知识库节点信息'),
    output: 'json',
    // 解开后的目标是节点挂的文档；节点信息按节点自己的 token 取
    cli: (_a, x) => ({ args: ['wiki', '+node-get', '--node-token', x!.nodeToken ?? x!.token] }),
  },
  {
    tool: 'feishu_wiki',
    action: 'children',
    level: 'discover',
    target: { arg: 'node', kind: 'wiki', accept: ['docx', 'doc', 'sheet', 'bitable', 'slides', 'file', 'mindnote'] },
    label: () => t('列出知识库子页面'),
    output: 'list',
    summary: () => t('列出这个节点下面的子页面（标题和链接）；子页面的内容要读时会再问你'),
    cli: (a, x) => {
      const out = ['wiki', '+node-list', '--space-id', x?.spaceId ?? '']
      // 节点 token 是解开前的那个（wiki 链接里的），不是挂的文档的 token
      opt(out, 'parent-node-token', x?.nodeToken)
      opt(out, 'page-size', num(a, 'limit'))
      opt(out, 'page-token', str(a, 'page_token'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_wiki',
    action: 'spaces',
    level: 'discover',
    label: () => t('列出知识库空间'),
    output: 'list',
    summary: () => t('列出你能看到的全部知识库空间（只有名字和编号）'),
    cli: (a) => {
      const out = ['wiki', '+space-list']
      opt(out, 'page-size', num(a, 'limit'))
      opt(out, 'page-token', str(a, 'page_token'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_minutes',
    action: 'search',
    level: 'discover',
    label: () => t('搜索妙记'),
    output: 'list',
    summary: (a) =>
      [
        t('搜索词：{q}', { q: str(a, 'query') || t('（空）') }),
        str(a, 'start') || str(a, 'end') ? t('时间：{from} ~ {to}', { from: str(a, 'start'), to: str(a, 'end') }) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    cli: (a) => {
      const out = ['minutes', '+search']
      opt(out, 'query', str(a, 'query'))
      opt(out, 'start', str(a, 'start'))
      opt(out, 'end', str(a, 'end'))
      opt(out, 'page-size', num(a, 'limit'))
      opt(out, 'page-token', str(a, 'page_token'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_minutes',
    action: 'detail',
    level: 'read',
    target: { arg: 'minute', kind: 'minutes', accept: ['minutes'] },
    label: () => t('读取妙记'),
    output: 'json',
    cli: (a, x) => {
      const out = ['minutes', '+detail', '--minute-tokens', x!.token, '--summary', '--todo', '--chapter', '--keyword']
      if (a.transcript === true) out.push('--transcript', '--output-dir', '{dir}')
      return { args: out }
    },
  },
]
