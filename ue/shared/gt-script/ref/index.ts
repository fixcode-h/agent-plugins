/**
 * GameTest v5 对象引用（协议：UEKit docs/game-test-ref.md）。前端编辑页、服务端校验、Agent 工具共用，纯函数。
 * - types：数据类型；ref：三种写法、target、类名、in 成环；path：属性路径 v5；states：算出状态表
 * - compare/：比较表（kind → op，一类一个文件 + 注册表）；describe：人话描述；collect：场景里写引用的地方、改名
 * - validate：v5 离线校验（第 10 节错误码）。旧版本不迁移（用户 2026-11-21），读到只报 schema_old
 */
export * from './types.ts'
export * from './ref.ts'
export * from './path.ts'
export * from './ident-tree.ts'
export * from './states.ts'
export * from './compare/index.ts'
export * from './describe.ts'
export * from './collect.ts'
export * from './validate.ts'
