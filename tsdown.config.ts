// dsh-doudizhu 构建配置
// 产出 server 入口 index + client 入口 client（.js，与 DSH 插件约定一致）
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
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    // 宿主提供：不打包
    neverBundle: [/@deepseek-ai\/.*/, /^react/, /^react-dom/, /^cordis/],
  },
})
