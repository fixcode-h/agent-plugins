import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectState, UeProject } from '../../../../server/types.ts'
import type { ExtensionStatus } from '../../../../server/uekit/catalog.ts'
import { extView, upgradePlan, uelinkView } from './model.ts'

// 用户实际碰到的：UELink 装 2.3.0（正式版最新），AssetForge 装着 1.0.0-beta.2，
// 能升的 1.2.0-beta.2 要 UELink ≥ 2.4.0-beta.2，只有 2.4.0-beta.3 预发布能满足
const project = { id: 'p', root: '/p', engine: { version: '5.4' } } as unknown as UeProject
const state = { bridge: '2.3.0', bundled: '2.3.0', instances: [] } as unknown as ProjectState
const forge: ExtensionStatus = {
  name: 'AssetForge',
  displayName: 'AssetForge',
  description: '',
  known: true,
  installed: { version: '1.0.0-beta.2', rel: 'Plugins/AssetForge' },
  offer: {
    version: '1.2.0-beta.2',
    prerelease: true,
    blockers: ['要 UELink >=2.4.0-beta.2，项目里是 2.3.0：先在上面升级 UELink'],
    uelink: '2.4.0-beta.3',
  },
  info: { requires: { UELink: '>=2.4.0-beta.2' } } as unknown as ExtensionStatus['info'],
}

test('装着的扩展要新 UELink 预发布时，UELink 卡给预发布、扩展能连同 UELink 一起升', () => {
  const link = uelinkView(project, state, { items: [forge] })
  assert.equal(link.offer?.pre, '2.4.0-beta.3')
  assert.equal(link.upgrade, true)
  const v = extView(forge, link)
  assert.equal(v.withUELink, true)
  assert.deepEqual(v.offer?.blockers, [])
  const plan = upgradePlan(link, [v])
  assert.deepEqual(plan.uelink, { prerelease: '2.4.0-beta.3' })
  assert.equal(plan.extensions[0].name, 'AssetForge')
})

test('装着的扩展已是能装的那一版时，不为它把 UELink 升到预发布', () => {
  const same = { ...forge, installed: { version: '1.2.0-beta.2', rel: 'Plugins/AssetForge' } }
  const link = uelinkView(project, state, { items: [same] })
  assert.equal(link.offer, undefined)
})
