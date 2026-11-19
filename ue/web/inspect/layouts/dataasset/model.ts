import { isInternal, splitCategory, type Prop } from '../../../details/model.ts'

/**
 * 数据资产的分类索引（效果图 B8 左栏）：按细节面板的第一层分类数属性，顺序照细节面板（第一次出现的先列）；
 * UE 细节面板里不显示的内部状态不算。单测在 dataasset.test.ts
 */
export function categoriesOf(props: Prop[]): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = []
  for (const p of props) {
    if (isInternal(p)) continue
    const name = splitCategory(p.category).top
    const hit = out.find((c) => c.name === name)
    if (hit) hit.count++
    else out.push({ name, count: 1 })
  }
  return out
}

/** 只看一个分类：空是全部（内部状态也留着，细节面板自己放最后） */
export const inCategory = (props: Prop[], cat: string) =>
  cat ? props.filter((p) => !isInternal(p) && splitCategory(p.category).top === cat) : props

/** 类链里第一个「认得出」的父类（页头第二个徽标）：PrimaryDataAsset、DataAsset */
export function knownParent(chain: string[] | undefined, known: string[]) {
  return chain?.find((c) => known.includes(c))
}
