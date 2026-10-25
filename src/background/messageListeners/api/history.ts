import type { APIMAP } from '../../utils'
import { AHS } from '../../utils'

const API_HISTORY = {
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/history&toview/history.md#%E8%8E%B7%E5%8F%96%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95%E5%88%97%E8%A1%A8_web%E7%AB%AF
  // 风控会 412 掉来自 chrome-extension 源头的请求（签名有效也没用，实测同一条签名 URL
  // 在页面里重放是 code 0），所以这两个接口走 viaPageContext：转到内容脚本以页面身份发
  getHistoryList: {
    url: 'https://api.bilibili.com/x/web-interface/history/cursor',
    _fetch: {
      method: 'get',
    },
    params: {
      ps: 20,
      type: '',
      view_at: 0,
    },
    wbi: true,
    viaPageContext: true,
    afterHandle: AHS.J_D,
  },
  // 筛选参数（时长/时间/设备）从 B 站历史页主包逆向确认：启用任一高级筛选时原版也是
  // 从 cursor 接口切到这个 search 接口。空值参数（0）会被 URL 构建丢弃 = 不筛选
  searchHistoryList: {
    url: 'https://api.bilibili.com/x/web-interface/history/search',
    _fetch: {
      method: 'get',
    },
    params: {
      pn: 1,
      keyword: '',
      business: 'all',
      add_time_start: 0,
      add_time_end: 0,
      arc_max_duration: 0,
      arc_min_duration: 0,
      device_type: 0,
    },
    wbi: true,
    viaPageContext: true,
    afterHandle: AHS.J_D,
  },
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/history&toview/history.md#%E5%88%A0%E9%99%A4%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95
  deleteHistoryItem: {
    url: 'https://api.bilibili.com/x/v2/history/delete',
    _fetch: {
      method: 'post',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: {
        kid: '',
        csrf: '',
      },
    },
    afterHandle: AHS.J_D,
  },
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/history&toview/history.md#%E6%B8%85%E7%A9%BA%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95
  // business 可选：空=清空全部；批量管理按页签清空时传业务类型（archive/pgc/cheese/live/article/article-list，
  // 形状抄自原版历史页前端包 shanks/history-record 的 clearHistoryRecord）
  clearAllHistory: {
    url: 'https://api.bilibili.com/x/v2/history/clear',
    _fetch: {
      method: 'post',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: {
        business: '',
        csrf: '',
      },
    },
    afterHandle: AHS.J_D,
  },
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/history&toview/history.md#%E6%9F%A5%E8%AF%A2%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95%E5%81%9C%E7%94%A8%E7%8A%B6%E6%80%81
  getHistoryPauseStatus: {
    url: 'https://api.bilibili.com/x/v2/history/shadow',
    _fetch: {
      method: 'get',
    },
    params: {},
    afterHandle: AHS.J_D,
  },
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/history&toview/history.md#%E5%81%9C%E7%94%A8%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95
  setHistoryPauseStatus: {
    url: 'https://api.bilibili.com/x/v2/history/shadow/set',
    _fetch: {
      method: 'post',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: {
        switch: false,
        csrf: '',
      },
    },
    afterHandle: AHS.J_D,
  },
} satisfies APIMAP

export default API_HISTORY
