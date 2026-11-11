import { LayoutGrid, MessagesSquare, PenLine, Sparkles, Wand2 } from 'lucide-react'
import type { AnalysisArea, AnalysisFinding, DesignAnalysis } from '@shared/design-analysis'
import { CopyButton } from '@/components/chat/ChatMessage'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { t } from '@shared/i18n'

const AREAS: { area: AnalysisArea; title: string; icon: typeof MessagesSquare }[] = [
  { area: 'process', title: t('对话过程问题'), icon: MessagesSquare },
  { area: 'ui', title: t('UI 结果问题'), icon: LayoutGrid },
  { area: 'capability', title: t('生成能力改进建议'), icon: Wand2 },
]

const PRIORITY: Record<AnalysisFinding['priority'], { label: string; className: string }> = {
  high: { label: t('高'), className: 'ud:bg-danger/10 ud:text-danger' },
  medium: { label: t('中'), className: 'ud:bg-warning/12 ud:text-warning' },
  low: { label: t('低'), className: 'ud:bg-sel ud:text-subtle' },
}

/** 生成能力建议按高中低排，其余按模型给的顺序 */
function sortFindings(list: AnalysisFinding[]) {
  const rank = { high: 0, medium: 1, low: 2 } as const
  return [...list].sort((a, b) => rank[a.priority] - rank[b.priority])
}

/**
 * 「AI 分析」的结果卡片：对话过程、UI 结果、生成能力三段。
 * 每条带证据和可直接执行的修改要求，点「按建议修改」把要求发给对话。
 */
export function DesignAnalysisCard({
  analysis,
  disabled,
  onApply,
}: {
  analysis: DesignAnalysis
  /** 正在发消息或执行时不能再发 */
  disabled?: boolean
  onApply?: (text: string) => void
}) {
  const groups = AREAS.map((a) => ({
    ...a,
    list:
      a.area === 'capability'
        ? sortFindings(analysis.findings.filter((f) => f.area === a.area))
        : analysis.findings.filter((f) => f.area === a.area),
  }))
  return (
    <div className="ud:mt-1.5 ud:rounded-xl ud:bg-card ud:shadow-card/70 ud:p-2.5 ud:shadow-card">
      <div className="ud:flex ud:items-center ud:gap-1.5 ud:px-0.5 ud:text-footnote ud:font-medium">
        <Sparkles className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-accent-text" />
        <span className="ud:min-w-0 ud:flex-1">{t('AI 分析结果')}</span>
        <span className="ud:shrink-0 ud:text-caption ud:font-normal ud:text-subtle">
          {t('{n} 条建议', { n: analysis.findings.length })}
        </span>
      </div>
      {!analysis.findings.length ? (
        <p className="ud:mt-2 ud:px-0.5 ud:text-footnote ud:leading-relaxed ud:text-muted">
          {t('这次没有解析出结构化的检查项，可以先看上面的结论，或者再分析一次。')}
        </p>
      ) : (
        <div className="ud:mt-2 ud:flex ud:flex-col ud:gap-2.5">
          {groups.map(({ area, title, icon: Icon, list }) => (
            <section key={area} className="ud:flex ud:flex-col ud:gap-1.5">
              <div className="ud:flex ud:items-center ud:gap-1.5 ud:px-0.5 ud:text-footnote ud:font-medium ud:text-muted">
                <Icon className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-accent-text" />
                <span>{title}</span>
                <span className="ud:text-caption ud:font-normal ud:text-subtle">{list.length}</span>
              </div>
              {!list.length ? (
                <p className="ud:px-0.5 ud:text-caption ud:text-subtle">{t('没有发现明显问题')}</p>
              ) : (
                list.map((f, i) => (
                  <Finding
                    key={`${f.area}:${i}:${f.title}`}
                    finding={f}
                    disabled={disabled}
                    onApply={onApply}
                    showPriority={area === 'capability'}
                  />
                ))
              )}
            </section>
          ))}
        </div>
      )}
      {!!analysis.findings.some((f) => f.suggestion) && (
        <p className="ud:mt-2 ud:border-t ud:px-0.5 ud:pt-2 ud:text-caption ud:leading-relaxed ud:text-subtle">
          {t('「按建议修改」会把这条要求作为一条新消息发给 AI；想改措辞可以先复制。')}
        </p>
      )}
    </div>
  )
}

function Finding({
  finding,
  disabled,
  onApply,
  showPriority,
}: {
  finding: AnalysisFinding
  disabled?: boolean
  onApply?: (text: string) => void
  showPriority?: boolean
}) {
  const p = PRIORITY[finding.priority]
  return (
    <div className="ud:rounded-lg ud:bg-bg/60 ud:p-2">
      <div className="ud:flex ud:min-w-0 ud:items-start ud:gap-1.5">
        <span className="ud:min-w-0 ud:flex-1 ud:text-footnote ud:leading-snug ud:font-medium">{finding.title}</span>
        {showPriority && (
          <span className={cn('ud:shrink-0 ud:rounded-sm ud:px-1 ud:py-px ud:text-micro ud:font-medium', p.className)}>
            {p.label}
          </span>
        )}
      </div>
      {finding.detail && (
        <p className="ud:mt-1 ud:text-caption ud:leading-relaxed ud:whitespace-pre-wrap ud:text-muted">
          {finding.detail}
        </p>
      )}
      {finding.evidence && (
        <p className="ud:mt-1 ud:rounded-sm ud:bg-sel/60 ud:px-1.5 ud:py-1 ud:font-mono ud:text-caption ud:leading-relaxed ud:whitespace-pre-wrap ud:text-subtle">
          {t('证据：')}
          {finding.evidence}
        </p>
      )}
      {finding.suggestion && (
        <div className="ud:mt-1.5 ud:flex ud:items-start ud:gap-1">
          <p className="ud:min-w-0 ud:flex-1 ud:text-caption ud:leading-relaxed ud:whitespace-pre-wrap ud:text-fg/85">
            {finding.suggestion}
          </p>
          <div className="ud:flex ud:shrink-0 ud:items-center ud:gap-0.5">
            <CopyButton text={finding.suggestion} label={t('复制这条建议')} className="ud:h-6 ud:w-6 ud:rounded-md" />
            {onApply && (
              <Button
                variant="link"
                disabled={disabled}
                onClick={() => onApply(finding.suggestion)}
                title={disabled ? t('等当前这一轮结束再修改') : t('把这条要求发给 AI')}
                className="ud:h-6 ud:shrink-0 ud:px-1.5 ud:text-caption"
              >
                <PenLine className="ud:h-3 ud:w-3" />
                {t('按建议修改')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
