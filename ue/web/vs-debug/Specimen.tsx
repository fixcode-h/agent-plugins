import { useState } from 'react'
import type { VsDebugState } from '../../server/types.ts'
import { h } from '../host.ts'
import { EMPTY_PARAMS, type LaunchParams } from './model.ts'
import { VsDebugView } from './VsDebugView.tsx'

/** 示例数据（不翻译）：没开 VS、运行中、停在断点带断点列表三种状态，设置 →「组件」和截图共用 */
export const VS_SAMPLES: Record<'noVs' | 'run' | 'break', VsDebugState> = {
  noVs: {
    available: false,
    reason: 'no-vs',
    message: 'VS 没打开这个项目（MyGame.sln），开着的 VS 里是别的项目',
    solution: 'D:/Projects/MyGame/MyGame.sln',
    others: [{ pid: 18244, solution: 'D:/Projects/Tools/Tools.sln' }],
    devenv: 'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/devenv.exe',
  },
  run: {
    available: true,
    status: {
      mode: 'run',
      building: false,
      startupProject: 'MyGame',
      configuration: 'DebugGame Editor|Win64',
      processes: [{ pid: 23816, name: 'UnrealEditor.exe' }],
      breakpoints: 2,
    },
    breakpoints: [
      { i: 1, file: 'D:/Projects/MyGame/Source/MyGame/Bag/BagComponent.cpp', line: 128, enabled: true, bound: 1 },
      {
        i: 2,
        function: 'AMyCharacter::Jump',
        enabled: false,
        byAgent: true,
        bound: 1,
      },
    ],
  },
  break: {
    available: true,
    status: {
      mode: 'break',
      building: false,
      lastReason: 'breakpoint',
      startupProject: 'MyGame',
      configuration: 'DebugGame Editor|Win64',
      processes: [{ pid: 23816, name: 'UnrealEditor.exe' }],
      breakpoints: 4,
      breakCount: 3,
      thread: { id: 1204, name: 'GameThread' },
      breakpoint: 'BagComponent.cpp:128',
      location: {
        function: 'UBagComponent::RemoveItem(int ItemId, int Count)',
        file: 'D:/Projects/MyGame/Source/MyGame/Bag/BagComponent.cpp',
        line: 128,
      },
      stack: [
        {
          i: 0,
          function: 'UBagComponent::RemoveItem',
          file: 'D:/Projects/MyGame/Source/MyGame/Bag/BagComponent.cpp',
          line: 128,
        },
        {
          i: 1,
          function: 'UBagWidget::OnDropItem',
          file: 'D:/Projects/MyGame/Source/MyGame/UI/BagWidget.cpp',
          line: 64,
        },
        { i: 2, function: 'UWidget::OnDrop', module: 'UnrealEditor-UMG.dll' },
        { i: 3, function: 'SObjectWidget::OnDrop', module: 'UnrealEditor-UMG.dll' },
        { i: 4, function: 'FSlateApplication::RoutePointerUpEvent', module: 'UnrealEditor-Slate.dll' },
        { i: 5, function: 'FSlateApplication::ProcessMouseButtonUpEvent', module: 'UnrealEditor-Slate.dll' },
      ],
    },
    breakpoints: [
      {
        i: 1,
        file: 'D:/Projects/MyGame/Source/MyGame/Bag/BagComponent.cpp',
        line: 128,
        enabled: true,
        hits: 3,
        bound: 1,
      },
      {
        i: 2,
        file: 'D:/Projects/MyGame/Source/MyGame/Bag/BagComponent.cpp',
        line: 141,
        enabled: true,
        condition: 'Count > Stack.Num',
        byAgent: true,
        bound: 1,
      },
      {
        i: 3,
        file: 'D:/Projects/MyGame/Source/MyGame/UI/BagWidget.cpp',
        line: 70,
        enabled: true,
        message: 'Drop {ItemId} x{Count}',
        byAgent: true,
        bound: 0,
      },
      { i: 4, function: 'AMyCharacter::Jump', enabled: false, hitCount: 5, bound: 1 },
    ],
  },
}

export function VsDebugSpecimen() {
  const { toast } = h()
  const [params, setParams] = useState<LaunchParams>({ ...EMPTY_PARAMS, map: '/Game/Maps/Test', game: true })
  const noop = (op: string) => toast.success(`demo: ${op}`)
  return (
    <div className="ue:grid ue:w-full ue:gap-3 ue:xl:grid-cols-3">
      {(['noVs', 'run', 'break'] as const).map((k) => (
        <div key={k} className="ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
          <VsDebugView
            vs={VS_SAMPLES[k]}
            params={params}
            onParams={setParams}
            onOp={(op) => noop(op)}
            onOpenVs={() => noop('open-vs')}
          />
        </div>
      ))}
    </div>
  )
}
