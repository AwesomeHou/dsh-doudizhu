/**
 * dsh-doudizhu 服务端插件入口（Cordis）
 * M1 阶段以客户端为主：这里只做加载确认与生命周期日志。
 * M2 起在此注册本地工具（DSH Agent 桥接等）。
 */
import type { Context } from 'cordis'

export const name = 'dsh-doudizhu'

/** 本插件需要的主机服务（M1 无额外依赖） */
export const inject: string[] = []

export function apply(ctx: Context): void {
  const log = ctx.logger('dsh-doudizhu')
  ctx.on('ready' as any, () => {
    log.info('斗地主插件已加载（M1 本地模式）')
  })
}
