import path from 'node:path'

import fs from 'fs-extra'
import { defineConfig } from 'tsup'

import { isDev, isFirefox, isSafari } from './scripts/utils'

const outDir = isFirefox ? 'extension-firefox/dist' : isSafari ? 'extension-safari/dist' : 'extension/dist'

export default defineConfig(() => ({
  entry: {
    'background/index': './src/background/index.ts',
    ...(isDev ? { mv3client: './scripts/client.ts' } : {}),
  },
  async onSuccess() {
    fs.copySync(path.resolve(__dirname, './src/inject/index.js'), path.resolve(__dirname, `./${outDir}/inject/index.js`))
    // 主世界桥（纯静态文件，不经打包）：注入页面时以页面身份发请求，见 contentScripts/index.ts
    fs.copySync(path.resolve(__dirname, './src/mainWorldBridge.js'), path.resolve(__dirname, `./${outDir}/mainWorldBridge.js`))
  },
  outDir,
  format: ['esm'],
  // The background script is registered as a plain service worker (the manifest does not set
  // `"type": "module"`), so it cannot contain a bare `import`. Anything listed in `dependencies`
  // is external by default and would be emitted as an import — `md5` has to be bundled in.
  noExternal: ['md5'],
  target: 'esnext',
  ignoreWatch: ['**/extension/**', '**/extension-firefox/**', '**/extension-safari/**'],
  splitting: false,
  sourcemap: false, // https://github.com/vitejs/vite-plugin-vue/issues/35
  define: {
    '__DEV__': JSON.stringify(isDev),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    'process.env.FIREFOX': isFirefox ? 'true' : 'false',
  },
  platform: 'browser',
  minifyWhitespace: !isDev,
  minifySyntax: !isDev,
}))
