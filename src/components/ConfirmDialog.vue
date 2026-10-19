<script setup lang="ts">
/**
 * 二次确认对话框。
 *
 * 取代浏览器原生的 `confirm()`：原生弹窗在扩展里风格不统一，也拿不到主题。
 * 确认文案（`*_confirm` 系列）都是刻意写成两行的——第一行是问句，第二行补一句「无法撤销」，
 * 本来就是给「标题 + 正文」准备的，只是原生 confirm 会把换行渲染成空格、拼成一整段。
 * 这里按换行拆开分别喂给 Dialog 的 title 和 desc。
 */
const props = defineProps<{
  /** 完整的确认文案，通常直接传对应语言里的确认文案 */
  message: string
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
}>()

const show = defineModel<boolean>()

const parts = computed(() => {
  const [title, ...rest] = props.message.split('\n')
  return { title, desc: rest.join(' ') }
})
</script>

<template>
  <Dialog
    v-if="show"
    append-to-bewly-body
    :title="parts.title"
    :show-close-button="false"
    :dim-background="false"
    glass-strength="strong"
    @confirm="emit('confirm')"
    @close="show = false"
  >
    <!-- 补充说明放内容区而不是 header 的 desc：header 那一行还要放关闭按钮，正文只剩两百来像素，
         中文长句会被从词中间掰断。放在这里才能占满对话框宽度。 -->
    <p v-if="parts.desc">
      {{ parts.desc }}
    </p>
  </Dialog>
</template>
