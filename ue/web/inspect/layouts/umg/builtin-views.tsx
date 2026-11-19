import { BlueprintView } from '../../../Blueprint.tsx'
import { t } from '../../../host.ts'
import { InfoView } from '../common.tsx'
import { ConfigView } from './ConfigView.tsx'
import { addUmgView } from './views.ts'

/** 内置的几个视图（设计器以外）：图表复用蓝图的图表视图，配置原文，摘要与引用。后两个只要 UE 能答（资源已生成） */
addUmgView({
  id: 'graph',
  label: () => t('图表'),
  when: ({ offline }) => !offline,
  View: ({ path, onOpen, onChanged }) => (
    <BlueprintView key={path} path={path} onOpen={(p) => onOpen(p, t('蓝图'))} onChanged={() => onChanged?.()} />
  ),
})
addUmgView({
  id: 'config',
  label: () => t('配置原文'),
  when: ({ data }) => !!data.configText || !!data.tree,
  View: ConfigView,
})
addUmgView({
  id: 'info',
  label: () => t('摘要与引用'),
  when: ({ offline }) => !offline,
  View: ({ path, onOpen }) => <InfoView path={path} onOpen={onOpen} />,
})
import './MarkupView.tsx'
