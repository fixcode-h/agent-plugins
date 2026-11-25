/**
 * 读 .uasset 出错的几种情况。kind 决定面板怎么处理：cooked / old / newer / not-package 是「这类文件不读」，
 * 直接告诉用户原因；corrupt 是读到一半对不上（多半是我们没实现的格式），显示原因并建议开着编辑器再看。
 */
export type UassetErrorKind = 'not-package' | 'cooked' | 'old' | 'newer' | 'corrupt' | 'unsupported'

export class UassetError extends Error {
  constructor(
    readonly kind: UassetErrorKind,
    message: string,
  ) {
    super(message)
  }
}
