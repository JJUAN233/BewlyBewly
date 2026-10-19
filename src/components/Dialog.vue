<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core'

import Button from '~/components/Button.vue'
import { useBewlyApp } from '~/composables/useAppProvider'

const props = withDefaults(defineProps<{
  title?: string
  desc?: string
  center?: boolean
  frostedGlass?: boolean
  appendToBewlyBody?: boolean
  width?: string | number
  maxWidth?: string | number
  contentHeight?: string | number
  contentMaxHeight?: string | number
  showFooter?: boolean
  centerFooter?: boolean
  /** 右上角的关闭按钮。纯确认类对话框可以关掉——它和「取消」完全同义，同时出现是重复的 */
  showCloseButton?: boolean
  /** 遮罩是否把背景压暗。关掉后遮罩还在（点击空白处仍然关闭），只是不变暗 */
  dimBackground?: boolean
  /** 面板毛玻璃强度，`strong` 用更厚的一档 */
  glassStrength?: 'default' | 'strong'
  loading?: boolean
  preventCloseWhenLoading?: boolean
}>(), {
  preventCloseWhenLoading: true,
  frostedGlass: true,
  showFooter: true,
  showCloseButton: true,
  dimBackground: true,
  glassStrength: 'default',
})

const emit = defineEmits(['close', 'confirm'])

onKeyStroke('Enter', (e: KeyboardEvent) => {
  e.preventDefault()
  if (!props.loading)
    handleConfirm()
})
onKeyStroke('Escape', (e: KeyboardEvent) => {
  e.preventDefault()
  if (props.loading && props.preventCloseWhenLoading)
    return
  handleClose()
})

const showShortcut = ref<boolean>(false)
const { mainAppRef } = useBewlyApp()
const showDialog = ref<boolean>(false)

const dialogWidth = computed(() => {
  return typeof props.width === 'number' ? `${props.width}px` : props.width || '400px'
})
const dialogMaxWidth = computed(() => {
  return typeof props.maxWidth === 'number' ? `${props.maxWidth}px` : props.maxWidth || 'calc(100vw - 32px)'
})
const dialogContentHeight = computed(() => {
  return typeof props.contentHeight === 'number' ? `${props.contentHeight}px` : props.contentHeight || 'auto'
})
const dialogContentMaxHeight = computed(() => {
  return typeof props.contentMaxHeight === 'number' ? `${props.contentMaxHeight}px` : props.contentMaxHeight || 'auto'
})

/** 走变量而不是写死数值，设置里的毛玻璃模糊强度（--bew-glass-blur-scale）和 `disable-frosted-glass` 才管得住 */
const backdropFilter = computed(() => {
  if (!props.frostedGlass)
    return 'none'
  return props.glassStrength === 'strong'
    ? 'var(--bew-filter-glass-2-strong)'
    : 'var(--bew-filter-glass-2)'
})

onKeyStroke('Alt', (e: KeyboardEvent) => {
  e.preventDefault()
  showShortcut.value = true
}, { eventName: 'keydown' })
onKeyStroke('Alt', (e: KeyboardEvent) => {
  e.preventDefault()
  showShortcut.value = false
}, { eventName: 'keyup' })

onMounted(() => {
  showDialog.value = true
})

onBeforeUnmount(() => {
  handleClose()
})

function handleClose() {
  if (props.loading && props.preventCloseWhenLoading)
    return

  showDialog.value = false
  nextTick(() => {
    emit('close')
  })
}

function handleConfirm() {
  emit('confirm')
  if (!props.loading) {
    nextTick(() => {
      handleClose()
    })
  }
}
</script>

<template>
  <Teleport :to="mainAppRef" :disabled="!appendToBewlyBody">
    <Transition name="modal">
      <div
        v-if="showDialog"
        class="dialog"
        pos="fixed top-0 left-0" w-full h-full z-10002
        pointer-events-auto
      >
        <div
          class="dialog-mask"
          bg="black opacity-40 dark:opacity-40"
          :class="{ '!bg-transparent': !dimBackground }"
          pos="absolute top-0 left-0" w-full h-full z-0
          @click="handleClose"
        />
        <div
          style="
            box-shadow: var(--bew-shadow-4), var(--bew-shadow-edge-glow-2);
          "
          :style="{
            width: dialogWidth,
            maxWidth: dialogMaxWidth,
            backdropFilter,
            backgroundColor: frostedGlass ? 'var(--bew-elevated)' : 'var(--bew-elevated-solid)',
          }"
          pos="absolute top-1/2 left-1/2" rounded="$bew-radius" border="1 $bew-border-color"
          transform="translate--1/2" z-2
          antialiased
        >
          <!-- loading masking -->
          <Transition name="fade">
            <div
              v-if="loading"
              pos="absolute top-0 left-0" w-full h-full bg="white dark:black opacity-60 dark:opacity-60" flex="~ justify-center items-center"
              z-2
            >
              <div i-svg-spinners-ring-resize text="4xl" />
            </div>
          </Transition>

          <header
            style="
              text-shadow: 0 0 15px var(--bew-elevated-solid), 0 0 20px var(--bew-elevated-solid)
            "
            pos="sticky top-0 left-0" w-full h-70px px-12 flex
            items-center justify-between
            rounded="t-$bew-radius" z-1
          >
            <div
              :style="{ textAlign: center ? 'center' : 'left' }"
              w-full
            >
              <slot name="title">
                <p text-xl fw-bold>
                  {{ title }}
                </p>
              </slot>
              <p text="sm $bew-text-2">
                <slot name="desc">
                  {{ desc }}
                </slot>
              </p>
            </div>

            <div
              v-if="showCloseButton"
              style="
                backdrop-filter: var(--bew-filter-glass-1);
                box-shadow: var(--bew-shadow-edge-glow-1), var(--bew-shadow-1);
              "
              text="!16px hover:$bew-theme-color" w="32px" h="32px"
              flex="~ items-center justify-center shrink-0"
              bg="$bew-fill-1 hover:$bew-theme-color-30"
              ml-8 rounded-8 cursor="pointer" border="1 $bew-border-color"
              box-border
              duration-300
              @click="handleClose"
            >
              <div i-ic-baseline-clear />
            </div>
          </header>

          <main
            :style="{
              height: dialogContentHeight,
              maxHeight: dialogContentMaxHeight,
              paddingBottom: !showFooter ? '2rem' : '0.5rem',
            }"
            p="x-12 y-2" relative overflow="x-hidden y-overlay"
          >
            <!-- <div h-80px mt--8 /> -->
            <slot />
          </main>
          <footer
            v-if="showFooter"
            :style="{ justifyContent: centerFooter || center ? 'center' : 'flex-end' }"
            flex="~ gap-2" p="x-12 t-2 b-6"
          >
            <Button type="tertiary" @click="handleClose">
              <div>
                {{ $t('common.operation.cancel') }}
                <span
                  v-show="showShortcut"
                  text="xs $bew-text-2 lh-0" p="x-1" rounded-4px bg="$bew-fill-1"
                  border="1 $bew-border-color"
                  mix-blend-color-dodge
                >
                  ESC
                </span>
              </div>
            </Button>
            <Button type="primary" @click="handleConfirm">
              <div>
                {{ $t('common.operation.confirm') }}
                <span
                  v-show="showShortcut"
                  text="xs $bew-text-2 lh-0" p="x-1" rounded-4px bg="$bew-fill-1"
                  border="1 $bew-border-color"
                  mix-blend-color-dodge
                >
                  ENTER
                </span>
              </div>
            </Button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
/**
 * 遮罩自己淡入。
 *
 * 打开时的渐显原来挂在根节点上（`.modal-enter-from` 的 opacity-0 scale-105），但根节点带上
 * opacity/transform 就成了 backdrop root，面板的 backdrop-filter 在动画期间只能采样根节点内部，
 * 采不到后面的页面——表现就是毛玻璃先被临时关掉、等动画结束才「啪」一下出现（`disable-frosted-glass`
 * 开着时本来就没有毛玻璃，看不出这个变化）。所以改成：根节点不做动画，渐显由遮罩负责，
 * 面板连同毛玻璃从第一帧就是最终样子。
 */
.dialog-mask {
  animation: dialog-mask-in 500ms ease;
}

@keyframes dialog-mask-in {
  from {
    opacity: 0;
  }
}
</style>
