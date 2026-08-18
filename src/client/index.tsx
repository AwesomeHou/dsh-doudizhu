/**
 * dsh-doudizhu 客户端入口
 * 通过 body portal 挂载一个「斗地主」浮动入口 + 全局面板（ADR-007：不依赖 shell 槽位，
 * 采用与 dsh-better-sidebar 相同的 document.body + createRoot 挂载方式）。
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DoudizhuApp } from './App.tsx'

/** 客户端所需服务（M1 无需额外服务） */
export const inject: string[] = []

export function apply(ctx: { effect(fn: () => (() => void) | void, label?: string): void }): void {
  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-doudizhu', '')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    root.render(createElement(DoudizhuApp))
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'dsh-doudizhu: mount')
}
