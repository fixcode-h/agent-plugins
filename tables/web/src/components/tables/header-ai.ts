import { t } from '@shared/i18n'
import { extractJson } from '@shared/assist'
import { TABLE_HEADER_LANG } from '@shared/table-header-ai'
import { resolveTablesProposal, tablesJsonOf } from '@shared/tables-assist'
import { runPromptInProject } from '@/lib/assist-conv'
import { tablesApi } from '@/lib/tables-api'

/**
 * 一张表的「AI 识别表头」：在项目里开一个分析对话，AI 看这张表开头几行和项目的表头配置给出要补的规则；
 * 结果在分析窗口右侧勾选应用（web/index.tsx 的 reports，tables-header 块），这里只核对格式对不对，不对让它改一次
 */
export function askHeaderAi(projectId: string, file: string, sheet: string) {
  runPromptInProject({
    projectId,
    title: t('AI 识别表头：{file} · {sheet}', { file: file.split('/').pop() ?? file, sheet }),
    prompt: async () => (await tablesApi.headerPrompt(projectId, file, sheet)).prompt,
    analysis: 'run',
    resolve: async (reply) => {
      const ex = tablesJsonOf(reply, extractJson, TABLE_HEADER_LANG)
      if (ex.error) return { error: ex.error }
      const r = resolveTablesProposal(ex.json)
      return r.proposal ? {} : { error: r.error ?? t('没有找到结果') }
    },
  })
}
