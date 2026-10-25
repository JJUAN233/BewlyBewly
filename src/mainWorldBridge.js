// 注入页面主世界的桥：B 站历史接口的风控会 412 掉扩展源头（含内容脚本隔离世界）的请求，
// 只有页面原生发出的才行。内容脚本把请求用 CustomEvent 递进来，这里以完全的页面身份
// （页面 Origin/Referer/UA/cookie）fetch，结果再用事件传回去。
// 见 contentScripts/index.ts 的注入处。必须是独立文件：B 站 CSP 禁内联脚本。
window.addEventListener('bewly-api-fetch-request', async (e) => {
  const { id, url, method, headers, body } = e.detail || {}
  try {
    const res = await fetch(url, { method, headers, body, credentials: 'include' })
    window.dispatchEvent(new CustomEvent('bewly-api-fetch-reply', { detail: { id, status: res.status, body: await res.text() } }))
  }
  catch (err) {
    window.dispatchEvent(new CustomEvent('bewly-api-fetch-reply', { detail: { id, status: 599, body: '' } }))
  }
})
