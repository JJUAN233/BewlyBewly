import 'overlayscrollbars/overlayscrollbars.css'

import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'

// 静态引入，不再走 defineAsyncComponent：异步块会让滑动条比页面内容晚一拍挂载，
// 叠加各使用处的 defer，就出现「页面先渲染、原生滚动条先顶着，滑动条组件后到再替换」
// 的闪动。现在组件随主包一起加载，和内容同一帧挂载、同一帧初始化。
export default OverlayScrollbarsComponent
