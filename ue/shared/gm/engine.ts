/**
 * 引擎自带的类：这些类（和它们的 Default__ 对象）上的 Exec 函数是引擎的调试命令，几十个，
 * 和项目自己的 GM 混在一起找不到（用户 2026-11-16 截图）。项目自己的子类（XXPlayerController）不在这里，算项目的
 */
const ENGINE = new Set(
  [
    'CheatManager',
    'CheatManagerExtension',
    'PlayerController',
    'HUD',
    'DebugCameraController',
    'DebugCameraHUD',
    'GameModeBase',
    'GameMode',
    'GameStateBase',
    'PlayerState',
    'Pawn',
    'Character',
    'DefaultPawn',
    'SpectatorPawn',
    'GameViewportClient',
    'LocalPlayer',
    'Engine',
    'GameEngine',
    'EditorEngine',
    'UnrealEdEngine',
    'AIController',
    'GameplayDebuggerCategoryReplicator',
    'GameplayDebuggerPlayerManager',
    'LogVisualizer',
    'AbilitySystemComponent',
    'AbilitySystemCheatManagerExtension',
    'GameplayCueManager',
    'EnhancedInputLocalPlayerSubsystem',
    'WorldPartitionSubsystem',
    'NavigationSystemV1',
  ].map((x) => x.toLowerCase()),
)
export const isEngineOwner = (owner: string) =>
  ENGINE.has(
    owner
      .replace(/^Default__/, '')
      .replace(/_C$/, '')
      .toLowerCase(),
  )
