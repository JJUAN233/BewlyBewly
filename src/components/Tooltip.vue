<script lang="ts" setup>
import { useBewlyApp } from '~/composables/useAppProvider'

const props = defineProps<{
  content: string
  placement: 'left' | 'right' | 'top' | 'bottom' | 'bottom-left' | 'bottom-right'
  type?: 'default' | 'dark' | 'white'
}>()

// Teleport 到应用根：原来提示是内联渲染在触发元素旁边的，一旦触发元素在
// overflow 不可见的容器里（如收藏夹列表），提示就会被容器边缘裁掉。
// 锚点元素保留在原位占坑，提示本体固定定位到 #bewly-wrapper 的顶层。
const { mainAppRef } = useBewlyApp()
const anchorRef = ref<HTMLElement | null>(null)
const visible = ref(false)
const tipStyle = ref<Record<string, string>>({})

function show() {
  const el = anchorRef.value
  if (!el)
    return

  const rect = el.getBoundingClientRect()
  const gap = 10
  const style: Record<string, string> = { position: 'fixed' }

  switch (props.placement) {
    case 'top':
      style.left = `${rect.left + rect.width / 2}px`
      style.top = `${rect.top - gap}px`
      style.transform = 'translate(-50%, -100%)'
      break
    case 'left':
      style.left = `${rect.left - gap}px`
      style.top = `${rect.top + rect.height / 2}px`
      style.transform = 'translate(-100%, -50%)'
      break
    case 'right':
      style.left = `${rect.right + gap}px`
      style.top = `${rect.top + rect.height / 2}px`
      style.transform = 'translate(0, -50%)'
      break
    case 'bottom-left':
      style.left = `${rect.left}px`
      style.top = `${rect.bottom + gap}px`
      break
    case 'bottom-right':
      style.left = `${rect.right}px`
      style.top = `${rect.bottom + gap}px`
      style.transform = 'translate(-100%, 0)'
      break
    // bottom
    default:
      style.left = `${rect.left + rect.width / 2}px`
      style.top = `${rect.bottom + gap}px`
      style.transform = 'translate(-50%, 0)'
      break
  }

  tipStyle.value = style
  visible.value = true
}

function hide() {
  visible.value = false
}
</script>

<template>
  <span
    ref="anchorRef"
    class="b-tooltip-wrapper"
    @mouseenter="show"
    @mouseleave="hide"
  >
    <slot />
  </span>
  <Teleport v-if="mainAppRef" :to="mainAppRef">
    <Transition name="fade">
      <div
        v-if="visible"
        class="b-tooltip"
        :class="[`b-tooltip--type-${type ?? 'default'}`]"
        :style="tipStyle"
      >
        {{ content }}
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.b-tooltip-wrapper {
  --uno: "flex items-center relative";
}

.b-tooltip {
  --uno: "fixed px-2 lh-2em rounded-8 pointer-events-none text-sm shadow-$bew-shadow-2 whitespace-nowrap z-10003";
}

.b-tooltip--type-default {
  --uno: "text-white dark:text-black bg-black dark:bg-white";
}

.b-tooltip--type-dark {
  --uno: "text-white bg-black";
}

.b-tooltip--type-white {
  --uno: "text-black bg-white";
}
</style>
