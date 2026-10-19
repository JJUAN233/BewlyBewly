import 'vue-toastification/dist/index.css'

import { createPinia } from 'pinia'
import type { App } from 'vue'
import Toast, { POSITION } from 'vue-toastification'

import components from '~/components'
import { i18n } from '~/utils/i18n'

const pinia = createPinia()

/**
 * Which part of the extension the current script runs in.
 *
 * This used to come from `webext-bridge`, and only the name was ever taken from it. Importing
 * that package runs `initIntercoms()` at module scope, which opens a long-lived
 * `runtime.connect()` port from every content script — and the browser closes every port of a
 * page that goes into the back/forward cache, so each in-tab navigation logged
 * `Unchecked runtime.lastError: … moved into back/forward cache`. Nothing here uses the library's
 * messaging (the injected script talks through plain DOM events), so the name is computed
 * locally instead.
 */
function getCurrentContext(): 'background' | 'content-script' | 'popup' | 'options' | 'devtools' | 'window' {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    return 'background'

  const { protocol, pathname } = location
  if (protocol === 'chrome-extension:' || protocol === 'moz-extension:') {
    if (pathname.includes('/popup'))
      return 'popup'
    if (pathname.includes('/options'))
      return 'options'
    if (pathname.includes('/devtools'))
      return 'devtools'
    return 'window'
  }

  return 'content-script'
}

export async function setupApp(app: App) {
  const context = getCurrentContext()

  // Inject a globally available `$app` object in template
  app.config.globalProperties.$app = { context }

  // Provide access to `app` in script setup with `const app = inject('app')`
  app.provide('app', app.config.globalProperties.$app)

  // Here you can install additional plugins for all contexts: popup, options page and content-script.
  // example: app.use(i18n)
  // example excluding content-script context: if (context !== 'content-script') app.use(i18n)
  app.use(i18n)
  app
    .use(Toast, {
      transition: 'Vue-Toastification__fade',
      maxToasts: 20,
      newestOnTop: true,
      position: POSITION.TOP_RIGHT,
    })
  app.use(components)
  app.use(pinia)
}
