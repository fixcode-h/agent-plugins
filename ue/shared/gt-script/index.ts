/**
 * GameTest 脚本数据层（协议：UEKit docs/game-test-script.md 的块、条件、表达式，docs/game-test-ref.md 的 v5 对象引用）。前端编辑页、流程图、服务端离线校验、Agent 工具共用，
 * 纯函数、不依赖 node 和面板宿主。
 * - types：数据类型；path：路径；walk：遍历和 id；script：读写和结构操作；rows：列表视图的行
 * - blocks/：块和动作的注册表（一种一个文件）
 * - cond：统一条件树；expr：表达式解析；functions：表达式内置函数和取值来源
 * - ref/：v5 对象引用（写法、属性路径、比较表、人话描述、引用收集、校验；旧版本不迁移）
 */
export * from './types.ts'
export * from './path.ts'
export * from './walk.ts'
export * from './script.ts'
export * from './rows.ts'
export * from './cond.ts'
export * from './expr.ts'
export * from './functions.ts'
export {
  allBlocks,
  blockOf,
  condsOf,
  idPrefixOf,
  isBlock,
  registerBlock,
  slotsOf,
  isSubgraph,
  LOOP_DEFAULT_MAX,
  LOOP_MAX_LIMIT,
  LOOP_MODES,
  loopModeOf,
  type LoopMode,
} from './blocks/index.ts'
export * from './names.ts'
export * from './ref/index.ts'
export * from './phase-hints.ts'
