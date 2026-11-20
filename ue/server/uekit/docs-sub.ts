import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * 项目文档根和它下面 AssetForge、GameTest 的目录（用户 2026-11-20 定：都统一到面板的项目文档根）。
 * 规则和 UEKit 的 AssetForgeSettings.cpp / GameTestSettings.cpp 一字不差（协议文档第 6 节「项目文档根」）：
 * 面板把算好的文档根写进 UE 项目的 Saved/AgentPanel/docs-root.txt（一行绝对路径），UE 里的扩展和这里都读它；
 * 没有这个文件时按旧规则。不 import 桥接和插件上下文，单测不用面板就能跑
 */

/** 面板写给 UE 的文档根提示文件 */
export const hintFile = (root: string) => path.join(root, 'Saved', 'AgentPanel', 'docs-root.txt')

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 旧规则：项目外层同级有 ProjectDoc/docs 就用它，否则是项目里的 docs */
export function legacyDocsRoot(root: string) {
  const pd = path.join(path.dirname(root), 'ProjectDoc', 'docs')
  return existsSync(pd) ? pd : path.join(root, 'docs')
}

/** 提示文件里的文档根：没有、不是绝对路径、目录不在都返回 undefined */
export function hintDocsRoot(root: string) {
  let text = ''
  try {
    text = readFileSync(hintFile(root), 'utf8').replace(/^﻿/, '').trim()
  } catch {
    return undefined
  }
  if (!text || !path.isAbsolute(text)) return undefined
  return isDir(text) ? path.resolve(text) : undefined
}

/** 文档根下的子目录：优先提示文件里的文档根；那里还没有、旧位置有时先用旧的（面板还没搬过去） */
export function docsSubDir(root: string, name: string) {
  const legacy = path.join(legacyDocsRoot(root), name)
  const hint = hintDocsRoot(root)
  if (!hint) return legacy
  const dir = path.join(hint, name)
  return !isDir(dir) && isDir(legacy) ? legacy : dir
}
