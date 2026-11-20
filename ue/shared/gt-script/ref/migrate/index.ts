/**
 * v1–v3 → v4 的迁移（协议 game-test-ref 第 9 节）：场景（script）、运行配置（settings）。
 * selector / cond / expr / objects / steps 是各部分的改写，面板「升级脚本」和 ue_gametest action=migrate 都用 migrateScript / migrateSettings。
 */
export { migrateScript, MIGRATE_TO, type MigrateResult } from './script.ts'
export { migrateSettings, type SettingsMigrateResult } from './settings.ts'
export { selectorToTarget } from './selector.ts'
export { migrateCond } from './cond.ts'
export { migrateExpr } from './expr.ts'
export { locatorToRef } from './objects.ts'
export { newCtx, type MigrateCtx, type MigrateTodo } from './context.ts'
