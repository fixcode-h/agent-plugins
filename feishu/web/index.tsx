import { lazy, Suspense } from 'react'
import type { ActivateWeb } from '../../sdk/web.ts'
import type { PluginConfig } from '../../sdk/server.ts'

const FeishuStatus = lazy(() =>
  import('./src/components/feishu/FeishuStatus').then((m) => ({ default: m.FeishuStatus })),
)

/**
 * 飞书插件的网页入口：设置 → 插件 → 飞书的参数表单下面，显示 lark-cli 的安装和登录状态、审计日志。
 * 授权卡用的是面板自己的请求卡片（插件接口 17 的「这个对话里一直允许」），不在这里画
 */
const activate: ActivateWeb = () => ({
  Status: (p: { status: Record<string, unknown> | undefined; config: PluginConfig; reload: () => void }) => (
    <Suspense fallback={null}>
      <FeishuStatus {...p} />
    </Suspense>
  ),
})

export default activate
