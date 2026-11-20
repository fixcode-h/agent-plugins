/**
 * GameTest v4 对象引用（协议：UEKit docs/game-test-ref.md）。前端编辑页、服务端校验和迁移、Agent 工具共用，纯函数。
 * - types：数据类型；ref：三种写法、target、类名、in 成环；prop-path：属性路径；states：算出状态表
 * - compare/：比较表（kind → op，一类一个文件 + 注册表）；describe：人话描述；collect：场景里写引用的地方、改名
 * - validate：v4 离线校验（第 10 节错误码）；migrate/：v1–v3 → v4
 */
export * from './types.ts'
export * from './ref.ts'
export * from './prop-path.ts'
export * from './states.ts'
export * from './compare/index.ts'
export * from './describe.ts'
export * from './collect.ts'
export * from './validate.ts'
export * from './migrate/index.ts'
