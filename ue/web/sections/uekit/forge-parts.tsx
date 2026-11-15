import { Info, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorText } from '../../ui.tsx'

/** AssetForge 右栏几个页签共用的小件：灰字提示、加载中、错误 */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="ue:flex ue:items-start ue:gap-1.5 ue:px-5 ue:py-3 ue:text-footnote ue:leading-relaxed ue:text-subtle">
      <Info className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function Loading() {
  return (
    <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
      <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="ue:p-4">
      <ErrorText>{children}</ErrorText>
    </div>
  )
}
