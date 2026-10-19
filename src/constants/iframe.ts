/**
 * 页面切换器用来展示 B 站页面的那个 iframe 的「浏览上下文名」（`<iframe name>`）。
 *
 * 为什么要给这个 iframe 起名：那个 iframe 里的 B 站页面同样会被注入扩展，它也会渲染一份自己的
 * 顶栏。这个模式下顶栏应该由外层页面负责——否则切过去时外层顶栏先卸载，再等 iframe 里的 B 站
 * 文档把整个 app（含顶栏、头像、未读数）从零启动一遍，观感就是「顶部的元素消失后重载」，而切回
 * BewlyBewly 页面时外层顶栏是用内存里已有的状态直接重建的，看起来就不会重载。
 *
 * 为什么用 `name` 而不是 postMessage：两者跨域都能用，但 `name` 在 iframe 的文档脚本跑起来之前
 * 就已经可读，内层据此可以「一开始就不画顶栏」；`postMessage` 要等文档加载、内层 app 挂载后才收
 * 得到，那之前内层那份顶栏已经画出来了（外层顶栏是透明的，两份会叠在一起）。
 */
export const PAGE_SWITCHER_IFRAME_NAME = 'bewly-page-switcher'
