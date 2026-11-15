/**
 * 从编辑器启动日志（Saved/Logs/<项目>.log）认出启动到了哪一步。
 *
 * UE 不往日志里写启动百分比（启动画面上的百分比只在 Slate 里画，进程外读不到），
 * 能拿到的只有几条固定出现的日志行：先认阶段，阶段之间再按上次启动用了多久按时间往前推，
 * 所以百分比是估算的；阶段名和着色器剩余个数是日志里读到的实数。
 * 阶段只往后走：前面的类别（LogInit）后面也会出现，不能让它把进度拉回去。
 */
export interface Stage {
  id: string
  /** 进入这一步时的百分比下限（估算） */
  at: number
  /** 认这一步的日志行 */
  re?: RegExp
}

export const STAGES: Stage[] = [
  { id: 'spawn', at: 0 },
  // 编辑器一打开就新建日志，第一行是 Log file open，紧跟着 LogInit 的版本、命令行
  { id: 'init', at: 4, re: /^Log file open|^(?:\[[^\]]*\]){0,2}LogInit:/ },
  { id: 'plugins', at: 10, re: /LogPluginManager:.*Mount/ },
  // 目标平台、着色器编译器准备好以后是一长段模块加载
  {
    id: 'modules',
    at: 20,
    re: /LogTargetPlatformManager|LogShaderCompilers:|LogTextureFormatManager|LogAudioCaptureCore/,
  },
  { id: 'assets', at: 40, re: /LogAssetRegistry:/ },
  { id: 'engine', at: 72, re: /Engine is initialized/ },
  { id: 'map', at: 82, re: /LoadMap\(|LogEditorServer:|Bringing World \/Game/ },
  { id: 'final', at: 94, re: /\(Engine Initialization\) Total time/ },
]

/** 「Worker (3/24): shaders left to compile 1234」「Shaders left to compile: 1234」这类行里的剩余个数 */
const SHADERS = /shaders? left to compile:?\s*(\d+)/i
const COMPILING = /Compiling\s+(\d+)\s+shaders?/i
/** 项目模块和编辑器版本对不上：UE 会弹「要不要重新编译」的窗口，停在那里等人点 */
const REBUILD = /Incompatible or missing module|modules are missing or built with a different engine version/i

export interface LogScan {
  /** STAGES 里走到的下标 */
  stage: number
  shadersLeft?: number
  /** 这次启动里见过的最多剩余着色器个数，算着色器那一段的进度用 */
  shadersMax?: number
  /** 在等用户点 UE 里的弹窗（模块要重新编译）：记下当时在哪一步，阶段再往后走就说明点掉了 */
  rebuildAt?: number
}

/** 读一段新日志，更新扫描结果（原地改，返回同一个对象） */
export function scanLines(scan: LogScan, text: string): LogScan {
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    for (let i = STAGES.length - 1; i > scan.stage; i--) {
      if (STAGES[i].re?.test(line)) {
        scan.stage = i
        break
      }
    }
    const m = SHADERS.exec(line) ?? COMPILING.exec(line)
    if (m) {
      const n = Number(m[1])
      scan.shadersLeft = n
      scan.shadersMax = Math.max(scan.shadersMax ?? 0, n)
    }
    if (REBUILD.test(line)) scan.rebuildAt = scan.stage
    else if (scan.rebuildAt !== undefined && scan.stage > scan.rebuildAt) scan.rebuildAt = undefined
  }
  return scan
}

/**
 * 估算百分比：至少是当前阶段的下限，最多到下一阶段下限减 1；阶段里按「已用时间 / 预计总时间」往前推。
 * 预计总时间取这个项目上次启动用的时间（没有就 90 秒）；超时后贴着上限走，不倒退
 */
export function estimate(scan: LogScan, elapsedMs: number, expectedMs: number) {
  const lo = STAGES[scan.stage].at
  const hi = (STAGES[scan.stage + 1]?.at ?? 99) - 1
  const byTime = 95 * Math.min(0.99, elapsedMs / Math.max(5000, expectedMs))
  return Math.round(Math.min(hi, Math.max(lo, byTime)))
}
