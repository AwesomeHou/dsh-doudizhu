// dsh-doudizhu 构建配置（骨架占位，M1 细化）
// 参照 dsh-better-sidebar 的 tsdown 用法：产出一个 server 入口 + 一个 client 入口。
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/index.tsx',
  },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [/@deepseek-ai\/.*/, /^react/, /^react-dom/, /^cordis/],
})
