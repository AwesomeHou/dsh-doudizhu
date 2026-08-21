/**
 * dsh-doudizhu 客户端入口
 * 通过 body portal 挂载侧边栏入口、独立工作区与画中画小窗，不依赖 AI 会话或工作区。
 * 入口采用与 dsh-better-sidebar 相同的 document.body + createRoot 挂载方式。
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DoudizhuApp } from './App.tsx'

/** 独立工作区只需要客户端运行时挂载能力。 */
export const inject: string[] = []

export function apply(ctx: ClientContext): void {
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
