/**
 * 面板文件弹窗里的表格文件（面板插件网页 SDK 的 SheetClaimer，分析稿第 26、27 条）：
 * 在项目表格目录里的，弹窗标题栏多「在表格页打开」，表头和两行列头按项目的表格结构文件来，和表格页显示得一样；
 * 弹窗里「调整表头」写回结构文件（以前记在浏览器里，换台电脑、表格页都看不到）。
 * 规则（哪些算表格页的文件）在服务端 server/tables/claim.ts，和表格页的文件列表同一套
 */
import { t } from '@shared/i18n'
import { dataStart } from '@shared/sheet-header'
import { emptySchema } from '@shared/tables'
import { columnInfos } from '@shared/table-struct'
import { colCount } from '@/lib/sheet'
import type { SheetClaim, SheetFile } from '../../../../sdk/web.ts'
import { colHeadOf } from '@/components/tables/col-head'
import { tableHeaderOf } from '@/components/tables/TableHeaderSetup'
import { toast } from '@/lib/toast'
import { tablesApi } from './tables-api'
import { onTableSchema, putTableSchema, saveTableSchema, tableSchemaOf } from './table-schema'

/** 认领：问服务端（没开表格功能的项目、表格目录外的文件都回 rel: null） */
export const sheetClaimer = {
  claim: async (file: SheetFile): Promise<SheetClaim | undefined> => {
    const { rel, same } = await tablesApi.claim(file.projectId, file.path, file.root)
    if (!rel) return undefined
    // 结构文件和表格页、项目设置共用一份；每次打开重读一次（可能被版本控制更新过）
    putTableSchema(file.projectId, await tablesApi.schema(file.projectId))
    return claimOf(file.projectId, rel, same)
  },
}

function claimOf(projectId: string, rel: string, same: boolean): SheetClaim {
  const schema = () => tableSchemaOf(projectId) ?? emptySchema()
  // 表格页里 CSV 只有一张表，名字是文件名（不带扩展名）；面板弹窗里 CSV 的工作表名是空串
  const csvName = /\.(csv|tsv)$/i.test(rel) ? rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '') : ''
  const sheetOf = (sheet: string) => csvName || sheet
  return {
    open: same
      ? {
          label: t('在表格页打开'),
          page: 'tables',
          // 表格页地址：<项目>/<文件>，带上正在看的工作表（#工作表）
          path: (sheet) => `${projectId}/${rel}${sheet && !csvName ? `#${sheet}` : ''}`,
        }
      : undefined,
    // 表头只按项目的表头配置（和表格页一样，不按内容猜）；弹窗里「调整表头」存成只管这个工作表的那条
    header: (sheet) =>
      tableHeaderOf(schema(), rel, sheetOf(sheet), (next) => {
        putTableSchema(projectId, next)
        // 在最新的结构文件上改，不盖掉别处刚存的
        void saveTableSchema(projectId, (cur) => ({
          ...cur,
          style: { ...cur.style, exceptions: next.style.exceptions },
        })).catch((e) => toast.error((e as Error).message))
      }).store,
    colHeads: (sheet, rows, header) =>
      columnInfos(schema(), rows.slice(0, dataStart(header)), header, rel, sheetOf(sheet), colCount(rows)).map(
        colHeadOf,
      ),
    subscribe: (f) => onTableSchema(f),
  }
}
