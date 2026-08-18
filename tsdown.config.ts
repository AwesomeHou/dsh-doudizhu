// dsh-doudizhu 构建配置
// 产出 server 入口 index + client 入口 client（.js，与 DSH 插件约定一致）
import { defineConfig } from 'tsdown'

const neverBundle = [/@deepseek-ai\/.*/, /^react/, /^react-dom/, /^cordis/]

export default defineConfig([
  {
    entry: 'src/index.ts',
    outDir: 'lib',
    format: ['esm'],
    dts: true,
    clean: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    deps: { neverBundle },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    dts: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    deps: { neverBundle },
    banner: {
      js: `window.__ModuleLoader__.load({\n\tid: "dsh-doudizhu",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    },
    footer: {
      js: '\n\t\treturn module.exports;\n\t}\n});',
    },
  },
])
