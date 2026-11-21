/** 运行配置 itemKeys 的一条（GameTest 1.4.0）：这类条目怎么认 */
export interface GtKeyRule {
  /** 条目类名（WBP_BagSlot，带不带 _C 都行） */
  entry: string
  /** 只管这个容器（选择器前缀）；空 = 这类条目在哪个容器里都这样认 */
  container?: string
  /** 条件左边的写法：@item.ItemId、@#cfgId、@.Level…… */
  by: string[]
}

/** 存盘前收拾：空行不存，by 按逗号拆 */
export function tidyKeyRules(rules: GtKeyRule[]) {
  return rules
    .map((r) => ({
      entry: r.entry.trim(),
      ...(r.container?.trim() ? { container: r.container.trim() } : {}),
      by: r.by.map((b) => b.trim()).filter(Boolean),
    }))
    .filter((r) => r.entry && r.by.length)
}
