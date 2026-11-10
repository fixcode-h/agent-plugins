// 性能测试用的样例数据：按 UE 5.4 的 CSV Profiler 和 memreport 的文件格式手写的生成器（不是真机抓的）。
// 解析器测试（perf-test.mjs）和假桥接（fake-bridge.mjs）共用。真实项目的样例拿到后放 fixtures/，这里的保留做稳定的断言。

/** 一份 CSV：frames 帧，60fps 左右；hitchAt 这些帧卡一下（游戏线程和 Slate 一起涨）；events 是 帧号 → 事件名 */
export function makeCsv({ frames = 600, hitchAt = [200, 201, 450], events = { 100: 'open_bag', 300: 'close_bag' }, slow = 0 } = {}) {
  const header =
    'EVENTS,FrameTime,GameThreadTime,RenderThreadTime,GPUTime,RHIThreadTime,MemoryFreeMB,PhysicalUsedMB,RHI/DrawCalls,RHI/PrimitivesDrawn,Slate/Tick,Exclusive/GameThread/Animation,Ticks/Total'
  const lines = [header]
  for (let f = 0; f < frames; f++) {
    const hitch = hitchAt.includes(f)
    const wobble = (f % 7) * 0.1
    const game = (hitch ? 70 : 6 + wobble) + slow
    const frame = Math.max(game, 16.6) + (hitch ? 2 : 0)
    lines.push(
      [
        events[f] ?? '',
        frame.toFixed(3),
        game.toFixed(3),
        (5 + wobble).toFixed(3),
        (9 + wobble).toFixed(3),
        (1 + wobble / 2).toFixed(3),
        (8000 - f).toFixed(1),
        (4000 + f * 0.5).toFixed(1),
        1800 + (f % 5) * 10,
        1200000 + (f % 3) * 1000,
        (hitch ? 55 : 1.2 + wobble / 4).toFixed(3),
        (2 + wobble / 3).toFixed(3),
        340 + (f % 4),
      ].join(','),
    )
  }
  // 引擎在末尾再写一遍列名，最后一行是元数据
  lines.push(header)
  lines.push(
    '[Platform],Windows,[Config],Development,[BuildVersion],++UE5+Release-5.4-CL-0,[EngineVersion],5.4.4-0+++UE5+Release-5.4,[DeviceProfile],WindowsEditor,[Commandline],"-game -log, -windowed",[TargetFramerate],60,[HasHeaderRowAtEnd],1',
  )
  return lines.join('\r\n') + '\r\n'
}

const pad = (s, n) => String(s).padStart(n)

/** 一份 memreport：extra 给某些类多加对象（模拟进出场景后没释放） */
export function makeMemReport({ extra = {} } = {}) {
  const classes = [
    ['Texture2D', 1200, 480.5, 512.0, 350000.25],
    ['StaticMesh', 800, 900.0, 960.0, 120000.5],
    ['SkeletalMesh', 60, 300.25, 320.0, 80000.0],
    ['SoundWave', 400, 150.0, 160.0, 40000.75],
    ['WBP_Bag_C', 2, 12.5, 14.0, 0],
    ['BP_Hero_C', 1, 8.0, 9.0, 0],
    ['Function', 90000, 15000.0, 15000.0, 0],
  ].map(([cls, count, num, max, res]) => {
    const add = extra[cls] ?? 0
    return [cls, count + add, num + add * 6.25, max + add * 7, res]
  })
  const head = `${pad('Class', 40)}${pad('Count', 9)}${pad('NumKB', 13)}${pad('MaxKB', 13)}${pad('ResExcKB', 13)}  ResExcDedSysKB  ResExcDedVidKB     ResExcUnkKB`
  const rows = classes.map(
    ([cls, count, num, max, res]) =>
      `${pad(cls, 40)}${pad(count, 9)}${pad(num.toFixed(2), 13)}${pad(max.toFixed(2), 13)}${pad(res.toFixed(2), 13)}${pad((res * 0.2).toFixed(2), 16)}${pad((res * 0.8).toFixed(2), 16)}${pad('0.00', 16)}`,
  )
  const total = classes.reduce((s, c) => s + c[1], 0)
  return [
    'CommandLine Options: -game -log',
    'Time Since Boot: 345.20 Seconds',
    '',
    'Platform Memory Stats for Windows',
    'Process Physical Memory: 4321.50 MB used, 4800.25 MB peak',
    'Process Virtual Memory: 9000.00 MB used, 9500.00 MB peak',
    'Physical Memory: 20000.00 MB used,  12000.00 MB free, 32000.00 MB total',
    '',
    'MemReport: Begin command "obj list -alphasort"',
    'Obj List: -alphasort',
    'Objects:',
    '',
    head,
    ...rows,
    '',
    `${total} Objects (Total: 16.850M / Max: 17.970M / Res: 590.001M | ResDedSys: 118.000M / ResDedVid: 472.001M / ResUnknown: 0.000M)`,
    'MemReport: End command "obj list -alphasort"',
    '',
    'MemReport: Begin command "ListTextures -alphasort"',
    'Listing all textures.',
    'MaxAllowedSize: Width x Height (Size in KB, Authored Bias), Current/InMem: Width x Height (Size in KB), Format, LODGroup, Name, Streaming, UnknownRef, VT, Usage Count, NumMips, Uncompressed',
    '4096x4096 (21845 KB, 0), 4096x4096 (21845 KB), PF_DXT5, TEXTUREGROUP_World, /Game/Env/T_Rock_D.T_Rock_D, YES, NO, NO, 4, 13, NO',
    '2048x2048 (5461 KB, 0), 1024x1024 (1365 KB), PF_DXT1, TEXTUREGROUP_UI, /Game/UI/T_BagBg.T_BagBg, NO, NO, NO, 1, 12, NO',
    '512x512 (341 KB, 0), 512x512 (341 KB), PF_BC7, TEXTUREGROUP_Character, /Game/Hero/T_Hero_N.T_Hero_N, YES, NO, NO, 2, 10, NO',
    'Total size: InMem= 23.00 MB  OnDisk= 27.00 MB  Count=3, CountApplicableToMin=2',
    'MemReport: End command "ListTextures -alphasort"',
    '',
    'MemReport: Begin command "rhi.DumpMemory"',
    'RHI resource memory (not tracked by our allocator)',
    '   1024.000 MB - Texture Memory 2D',
    '    256.000 MB - Vertex Buffer Memory',
    'MemReport: End command "rhi.DumpMemory"',
    '',
  ].join('\r\n')
}
