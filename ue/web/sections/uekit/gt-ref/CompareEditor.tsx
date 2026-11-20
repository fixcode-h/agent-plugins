import type { GtIdentItem, GtPropKind } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { parseScalar, scalarText } from '../gt-cond/compare.tsx'
import { ValueInput } from '../gt-cond/ValueInput.tsx'
import { COUNT_CMPS, KIND_OPS, KNOWN_ENUMS, NO_VALUE_OPS, opLabel } from './compare-table.ts'

/** kind 不知道时（编辑器没开、Lua 字段没声明类型）给的比较：数字和文字的都给 */
const LOOSE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'matches', 'in', 'is']

const VEC_DIMS: Partial<Record<GtPropKind, string[]>> = {
  vector: ['x', 'y', 'z'],
  rotator: ['pitch', 'yaw', 'roll'],
  vector2: ['x', 'y'],
  color: ['r', 'g', 'b', 'a'],
}

/**
 * 按属性类型出比较（协议 3.4、效果图 3）：bool 是 / 否分段；枚举、可见性分段或下拉（成员列表）；
 * 文字等于 / 包含 / 正则…、忽略大小写、按本地化键；数字、向量、颜色、数组个数。
 * 值都能写 $变量 和 = 表达式（ValueInput）。改的只是这一项的 op / value / tol / ignoreCase / cmp，prop 不动
 */
export function CompareEditor({
  value,
  onChange,
  kind,
  members: given = [],
  textKey,
}: {
  value: GtIdentItem
  onChange: (v: GtIdentItem) => void
  kind?: GtPropKind
  /** 枚举成员（gt.props 给，没有时按常见引擎枚举） */
  members?: string[]
  /** 此刻的本地化键（文字类）：提示「改成按本地化键」 */
  textKey?: string
}) {
  const { ui, cn } = h()
  // 可见性的成员是固定的：调用方没给（按类读、没连游戏）也能点选
  const members = given.length ? given : kind === 'visibility' ? KNOWN_ENUMS.ESlateVisibility : given
  const ops = kind ? KIND_OPS[kind] : LOOSE_OPS
  const op = value.op ?? (kind === 'bool' ? 'is' : 'eq')
  const set = (patch: Partial<GtIdentItem>) => {
    const next: GtIdentItem = { ...value, ...patch }
    for (const k of Object.keys(patch) as (keyof GtIdentItem)[]) if (patch[k] === undefined) delete next[k]
    onChange(next)
  }
  const setOp = (o: string) =>
    set({
      op: o,
      value: NO_VALUE_OPS.has(o) ? undefined : o === 'between' ? [0, 0] : o === 'in' ? [] : (value.value ?? ''),
      ...(o === 'count'
        ? { cmp: value.cmp ?? 'gte', value: typeof value.value === 'number' ? value.value : 1 }
        : { cmp: undefined }),
    })

  if (kind === 'struct' || kind === 'none')
    return <p className="ue:text-footnote ue:text-subtle">{t('这种类型不能直接比：展开成员选一个')}</p>

  const opSelect = (list = ops, w = 'ue:w-32') => (
    <ui.Select
      size="sm"
      className={cn(w, 'ue:shrink-0')}
      value={op}
      onChange={(e: { target: { value: string } }) => setOp(e.target.value)}
      options={(list.includes(op) ? list : [...list, op]).map((o) => ({ value: o, label: opLabel(o) }))}
    />
  )
  const text = (placeholder?: string, mono = true) => (
    <ValueInput
      className="ue:min-w-0 ue:flex-1"
      mono={mono}
      placeholder={placeholder ?? t('值，或 $变量、= 表达式')}
      value={scalarText(value.value)}
      onChange={(s) =>
        set({
          value: s.startsWith('=') || s.startsWith('$') ? s : kind === 'string' || kind === 'text' ? s : parseScalar(s),
        })
      }
    />
  )

  // bool：是 / 否
  if (kind === 'bool')
    return (
      <ui.Segmented
        size="sm"
        label={t('是或否')}
        value={value.value === false ? 'no' : 'yes'}
        onChange={(x: string) => set({ op: 'is', value: x === 'yes' })}
        options={[
          { id: 'yes', label: t('是') },
          { id: 'no', label: t('否') },
        ]}
      />
    )

  // 枚举 / 可见性：成员少用分段，多用下拉；in 多选；可见性另有「显示 / 隐藏」两个快捷
  if (kind === 'enum' || kind === 'visibility') {
    const quick = kind === 'visibility' && (op === 'visible' || op === 'hidden')
    const cur = typeof value.value === 'string' ? value.value.replace(/^\w+::/, '') : scalarText(value.value)
    const all = cur && !members.includes(cur) && op !== 'in' ? [...members, cur] : members
    return (
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        {kind === 'visibility' && (
          <ui.Segmented
            size="sm"
            label={t('可见性')}
            value={quick ? op : 'exact'}
            onChange={(x: string) =>
              x === 'exact' ? set({ op: 'is', value: members[0] ?? 'Visible' }) : set({ op: x, value: undefined })
            }
            options={[
              { id: 'visible', label: t('显示') },
              { id: 'hidden', label: t('隐藏') },
              { id: 'exact', label: t('具体值…') },
            ]}
          />
        )}
        {quick ? (
          <span className="ue:text-caption ue:text-subtle">
            {op === 'visible'
              ? t('显示 = Visible / HitTestInvisible / SelfHitTestInvisible')
              : t('隐藏 = Collapsed / Hidden')}
          </span>
        ) : (
          <div className="ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-1.5">
            {opSelect(['is', 'isNot', 'in'], 'ue:w-24')}
            {op === 'in' && !members.length ? (
              <ValueInput
                className="ue:min-w-0 ue:flex-1"
                placeholder={t('用逗号隔开')}
                value={scalarText(value.value)}
                onChange={(s) =>
                  set({
                    value: s
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : op === 'in' ? (
              <div className="ue:flex ue:flex-wrap ue:gap-1">
                {members.map((m) => {
                  const list = Array.isArray(value.value) ? (value.value as string[]) : []
                  const on = list.includes(m)
                  return (
                    <ui.Button
                      key={m}
                      size="sm"
                      variant={on ? 'secondary' : 'ghost'}
                      aria-pressed={on}
                      onClick={() => set({ value: on ? list.filter((x) => x !== m) : [...list, m] })}
                    >
                      {m}
                    </ui.Button>
                  )
                })}
              </div>
            ) : all.length && all.length <= 4 ? (
              <ui.Segmented
                size="sm"
                label={t('成员')}
                value={cur}
                onChange={(x: string) => set({ value: x })}
                options={all.map((m) => ({ id: m, label: memberLabel(m) }))}
              />
            ) : all.length ? (
              <ui.Select
                size="sm"
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                value={cur}
                onChange={(e: { target: { value: string } }) => set({ value: e.target.value })}
                options={all.map((m) => ({ value: m, label: m }))}
              />
            ) : (
              text(t('成员名，EX::A 或 A 都行'))
            )}
          </div>
        )}
      </div>
    )
  }

  // 向量、旋转、二维、颜色：几个数字一组 + 容差
  const dims = kind ? VEC_DIMS[kind] : undefined
  if (dims) {
    const arr = Array.isArray(value.value) ? (value.value as unknown[]) : []
    return (
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {opSelect(ops, 'ue:w-24')}
          {dims.map((d, i) => (
            <ui.Input
              key={d}
              size="sm"
              className="ue:w-0 ue:min-w-0 ue:flex-1 ue:font-mono"
              placeholder={d}
              value={arr[i] === undefined ? '' : String(arr[i])}
              onChange={(e: { target: { value: string } }) => {
                const next = dims.map((_, j) => (j < arr.length ? arr[j] : 0))
                next[i] = parseScalar(e.target.value.trim() || '0')
                set({ value: next })
              }}
            />
          ))}
        </div>
        <Tol value={value} onChange={set} placeholder={kind === 'color' ? '0.02' : kind === 'rotator' ? '1' : '10'} />
      </div>
    )
  }

  // 数组：个数比较、含有、空 / 不空
  if (kind === 'array')
    return (
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
        {opSelect(ops, 'ue:w-24')}
        {op === 'count' && (
          <ui.Select
            size="sm"
            className="ue:w-16 ue:shrink-0"
            value={value.cmp ?? 'gte'}
            onChange={(e: { target: { value: string } }) => set({ cmp: e.target.value })}
            options={COUNT_CMPS.map((c) => ({ value: c, label: opLabel(c) }))}
          />
        )}
        {!NO_VALUE_OPS.has(op) && text(op === 'count' ? t('数字') : undefined)}
      </div>
    )

  // 数字：between 两个框，in 逗号列表，浮点 eq 带容差
  if (kind === 'int' || kind === 'float') {
    const pair = Array.isArray(value.value) ? (value.value as unknown[]) : []
    return (
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {opSelect(ops, 'ue:w-24')}
          {op === 'between' ? (
            [0, 1].map((i) => (
              <ValueInput
                key={i}
                className="ue:min-w-0 ue:flex-1"
                placeholder={i ? t('到') : t('从')}
                value={scalarText(pair[i])}
                onChange={(s) => set({ value: [0, 1].map((j) => (j === i ? parseScalar(s) : pair[j])) })}
              />
            ))
          ) : op === 'in' ? (
            <ValueInput
              className="ue:min-w-0 ue:flex-1"
              placeholder={t('用逗号隔开：1, 2, 3')}
              value={scalarText(value.value)}
              onChange={(s) => set({ value: s.startsWith('=') ? s : s.split(',').map((x) => parseScalar(x.trim())) })}
            />
          ) : (
            text(t('数字，或 $变量、= 表达式'))
          )}
        </div>
        {kind === 'float' && op === 'eq' && <Tol value={value} onChange={set} placeholder="0.001" />}
      </div>
    )
  }

  // 文字（FString / FName / FText / Lua 字符串）、资源、对象、不知道的：比较下拉 + 值 + 忽略大小写
  const textLike = kind === 'string' || kind === 'text' || !kind
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
        {opSelect()}
        {!NO_VALUE_OPS.has(op) &&
          (op === 'in' ? (
            <ValueInput
              className="ue:min-w-0 ue:flex-1"
              mono={false}
              placeholder={t('用逗号隔开')}
              value={scalarText(value.value)}
              onChange={(s) => set({ value: s.startsWith('=') ? s : s.split(',').map((x) => x.trim()) })}
            />
          ) : (
            text(
              op === 'key' ? t('命名空间,键') : op === 'classIs' ? t('类名，子类也算') : undefined,
              op !== 'eq' || kind !== 'text',
            )
          ))}
        {textLike && !NO_VALUE_OPS.has(op) && op !== 'key' && (
          <label className="ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-caption ue:text-muted">
            <input
              type="checkbox"
              className="ue:accent-accent"
              checked={value.ignoreCase !== false}
              onChange={(e) => set({ ignoreCase: e.target.checked ? undefined : false })}
            />
            {t('忽略大小写')}
          </label>
        )}
      </div>
      {kind === 'text' && op !== 'key' && (
        <p className="ue:text-caption ue:text-warning">
          {t('按显示文字比，换语言会失效。')}
          {textKey && (
            <button
              type="button"
              className="ue:ml-1 ue:cursor-pointer ue:text-accent ue:hover:underline"
              onClick={() => set({ op: 'key', value: textKey, ignoreCase: undefined })}
            >
              {t('改成按本地化键 {k}', { k: textKey })}
            </button>
          )}
        </p>
      )}
    </div>
  )
}

/** 勾选框状态的中文（效果图 3：勾上 / 没勾 / 半选），其余成员原样 */
function memberLabel(m: string) {
  return ({ Checked: t('勾上'), Unchecked: t('没勾'), Undetermined: t('半选') } as Record<string, string>)[m] ?? m
}

/** 容差：不填用运行配置 refDefaults.tol */
function Tol({
  value,
  onChange,
  placeholder,
}: {
  value: GtIdentItem
  onChange: (p: Partial<GtIdentItem>) => void
  placeholder: string
}) {
  const { ui } = h()
  return (
    <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
      {t('容差')}
      <ui.Input
        size="sm"
        className="ue:w-20 ue:font-mono"
        placeholder={placeholder}
        value={value.tol === undefined ? '' : String(value.tol)}
        onChange={(e: { target: { value: string } }) => {
          const n = Number(e.target.value)
          onChange({ tol: e.target.value.trim() && Number.isFinite(n) ? n : undefined })
        }}
      />
      {t('不填按运行设置')}
    </div>
  )
}
