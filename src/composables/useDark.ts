import { usePreferredDark } from '@vueuse/core'

import { settings } from '~/logic'
import { runWhenIdle } from '~/utils/lazyLoad'
import { setCookie } from '~/utils/main'
import { executeTimes } from '~/utils/timer'

export function useDark() {
  const isPreferredDark = usePreferredDark()
  const currentSystemColorScheme = computed(() => isPreferredDark.value ? 'dark' : 'light')
  const currentAppColorScheme = computed((): 'dark' | 'light' => {
    if (settings.value.theme !== 'auto')
      return settings.value.theme
    else
      return currentSystemColorScheme.value
  })
  const isDark = computed(() => currentAppColorScheme.value === 'dark')
  let themeChangeTimer: NodeJS.Timeout | null = null

  // Watch for changes in the 'settings.value.theme' variable and add the 'dark' class to the 'mainApp' element
  // to prevent some Unocss dark-specific styles from failing to take effect
  watch(
    () => [settings.value.theme, isPreferredDark.value],
    () => {
      setAppAppearance()
    },
    { immediate: true },
  )

  // use watchEffect instead of onMounted because onMounted is only aviailable in setup function
  watchEffect(() => {
    // Because some shadow dom may not be loaded when the page has already loaded, we need to wait until the page is idle
    runWhenIdle(() => {
      if (isDark.value) {
        setCookie('theme_style', 'dark', 365 * 10)
        // TODO: find a better way implement this
        themeChangeTimer = executeTimes(() => {
          window.dispatchEvent(new CustomEvent('global.themeChange', { detail: 'dark' }))
        }, 10, 500)
      }
      else {
        setCookie('theme_style', 'light', 365 * 10)
        themeChangeTimer = executeTimes(() => {
          window.dispatchEvent(new CustomEvent('global.themeChange', { detail: 'light' }))
        }, 10, 500)
      }
    })
  })

  /**
   * Watch for changes in the 'settings.value.theme' variable and add the 'dark' class to the 'mainApp' element
   * to prevent some Unocss dark-specific styles from failing to take effect
   */
  function setAppAppearance() {
    if (themeChangeTimer)
      clearInterval(themeChangeTimer)

    if (isDark.value) {
      document.querySelector('#bewly')?.classList.add('dark')
      document.documentElement.classList.add('dark')
      // Applied synchronously, together with the classes above: the update callback of the view
      // transition only waits for the work done inside it, so a class queued with `nextTick()`
      // could miss the snapshot and leave the captured state differing from the real one.
      document.body?.classList.add('dark')
      // bili_dark is bilibili's official dark mode class
      document.documentElement.classList.add('bili_dark')

      setCookie('theme_style', 'dark', 365 * 10)
      window.dispatchEvent(new CustomEvent('global.themeChange', { detail: 'dark' }))
    }
    else {
      document.querySelector('#bewly')?.classList?.remove('dark')
      document.documentElement.classList.remove('dark')
      document.body?.classList.remove('dark')
      document.documentElement.classList.remove('bili_dark')

      setCookie('theme_style', 'light', 365 * 10)
      window.dispatchEvent(new CustomEvent('global.themeChange', { detail: 'light' }))
    }

    // Only used as a temporary solution, which will eventually be removed
    // It seems like Bilibili already supports dark mode when the `bili_dark` class is added to the `html` element
    // but it's not yet fully refined.
    if (currentAppColorScheme.value === 'dark') {
      if (document.documentElement.classList.contains('bili_dark')) {
        document.documentElement.classList.remove('bili_dark')
      }
    }
    // else {
    //   if (!document.documentElement.classList.contains('bili_dark')) {
    //     document.documentElement.classList.add('bili_dark')
    //   }
    // }
  }

  function toggleDark(e: MouseEvent) {
    const updateThemeSettings = () => {
      if (currentAppColorScheme.value !== currentSystemColorScheme.value)
        settings.value.theme = 'auto'
      else
        settings.value.theme = isPreferredDark.value ? 'light' : 'dark'
    }

    const isAppearanceTransition = typeof document !== 'undefined'
    // @ts-expect-error: Transition API
      && document.startViewTransition
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!isAppearanceTransition) {
      updateThemeSettings()
    }
    else {
      const x = e.clientX
      const y = e.clientY
      const endRadius = Math.hypot(
        Math.max(x, innerWidth - x),
        Math.max(y, innerHeight - y),
      )
      // The reveal animation itself lives in `main.scss`, as a CSS animation on the
      // `::view-transition-*` pseudo-elements. All it needs from here is where the circle starts
      // and how far it has to reach — the pseudo-elements inherit custom properties from the
      // root. A CSS animation is torn down together with the pseudo-element it runs on, so unlike
      // an animation created from script it cannot outlive the transition and interfere with the
      // next one.
      const root = document.documentElement
      root.style.setProperty('--bew-color-mode-x', `${x}px`)
      root.style.setProperty('--bew-color-mode-y', `${y}px`)
      root.style.setProperty('--bew-color-mode-radius', `${endRadius}px`)

      // https://github.com/vueuse/vueuse/pull/3129
      const style = document.createElement('style')
      const styleString = `
            *, *::before, *::after
            {-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}`
      style.appendChild(document.createTextNode(styleString))
      document.head.appendChild(style)

      // Since the above normal dom style cannot be applied in shadow dom style
      // We need to add this style again to the shadow dom
      const shadowDomStyle = document.createElement('style')
      const shadowDomStyleString = `
            *, *::before, *::after
            {-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important; will-change: background}`
      shadowDomStyle.appendChild(document.createTextNode(shadowDomStyleString))

      const bewlyShadowRoot = document.getElementById('bewly')?.shadowRoot
      const bewlyWrapper = bewlyShadowRoot?.getElementById('bewly-wrapper')
      if (!bewlyWrapper)
        throw new Error('mainAppRef is not found')

      bewlyWrapper.appendChild(shadowDomStyle)

      // @ts-expect-error: Transition API
      const transition = document.startViewTransition(() => {
        updateThemeSettings()
        // Apply the new appearance in this very task instead of waiting for the settings watcher
        // to flush. The update callback must stay synchronous: while the browser waits for a
        // promise returned by it, it is free to paint the document — which is already in the new
        // theme by then. That paint shows the page in the new theme for a moment, and the old
        // snapshot is then put back on top for the reveal, so the theme change is seen twice —
        // the flicker. With a synchronous callback there is no such gap.
        setAppAppearance()
      })

      // Taking the helper styles back out must not hang off an animation's `finish` event: a
      // skipped transition never fires it, which would leave `transition: none !important` and
      // `will-change: background` applied to the page for good — the latter promotes every element
      // to its own composited layer, which slows the whole page down and leaves the dock buttons
      // looking blurry.
      //
      // `finished` fulfils when the transition is merely skipped, but it *rejects* when the update
      // callback throws. A plain `.then()` would then skip the cleanup entirely and leak those
      // styles, so both outcomes have to be handled.
      transition.finished.finally(() => {
        style.remove()
        shadowDomStyle.remove()
        root.style.removeProperty('--bew-color-mode-x')
        root.style.removeProperty('--bew-color-mode-y')
        root.style.removeProperty('--bew-color-mode-radius')
      })
    }
  }

  return {
    isDark,
    toggleDark,
  }
}
