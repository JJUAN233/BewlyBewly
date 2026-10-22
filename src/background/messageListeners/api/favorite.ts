import type { APIMAP } from '../../utils'
import { AHS } from '../../utils'

const API_FAVORITE = {
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/fav/info.md#%E8%8E%B7%E5%8F%96%E6%8C%87%E5%AE%9A%E7%94%A8%E6%88%B7%E5%88%9B%E5%BB%BA%E7%9A%84%E6%89%80%E6%9C%89%E6%94%B6%E8%97%8F%E5%A4%B9%E4%BF%A1%E6%81%AF
  getFavoriteCategories: {
    url: 'https://api.bilibili.com/x/v3/fav/folder/created/list-all',
    _fetch: {
      method: 'get',
    },
    params: {
      up_mid: '',
    },
    afterHandle: AHS.J_D,
  },
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/fav/list.md#%E8%8E%B7%E5%8F%96%E6%94%B6%E8%97%8F%E5%A4%B9%E5%86%85%E5%AE%B9%E6%98%8E%E7%BB%86%E5%88%97%E8%A1%A8
  getFavoriteResources: {
    url: 'https://api.bilibili.com/x/v3/fav/resource/list',
    _fetch: {
      method: 'get',
    },
    params: {
      media_id: -1,
      pn: 1,
      ps: 20,
      keyword: '',
      order: 'mtime',
      type: 0,
      tid: 0,
      platform: 'web',
    },
    // 和首页推荐接口一样，风控也要求这个接口带 wts/w_rid，否则回 412 HTML 页面
    wbi: true,
    afterHandle: AHS.J_D,
  },
  // https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/fav/action.md#%E6%89%B9%E9%87%8F%E5%88%A0%E9%99%A4%E5%86%85%E5%AE%B9
  patchDelFavoriteResources: {
    url: 'https://api.bilibili.com/x/v3/fav/resource/batch-del',
    _fetch: {
      method: 'post',
    },
    params: {
      resources: '',
      media_id: 0,
      csrf: '',
    },
    afterHandle: AHS.J_D,
  },
  // 收藏夹的增改删都走表单 body 而不是 query：简介允许清空（空字符串），
  // 而 query 构建会丢弃空值参数。参数名以 B 站实际接口为准（备份文档
  // BACNext/bilibili-API-collect-backup docs/fav/action.md）：
  // 新建的标题字段是 title 不是 name；编辑用 media_id 不是 fid；
  // 删除用 media_ids（逗号分隔的列表）不是 fid——参数名错了接口会回 -400 请求错误
  addFavoriteFolder: {
    url: 'https://api.bilibili.com/x/v3/fav/folder/add',
    _fetch: {
      method: 'post',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: {
        title: '',
        intro: '',
        privacy: 0,
        csrf: '',
      },
    },
    afterHandle: AHS.J_D,
  },
  patchFavoriteFolder: {
    url: 'https://api.bilibili.com/x/v3/fav/folder/edit',
    _fetch: {
      method: 'post',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: {
        media_id: 0,
        title: '',
        intro: '',
        privacy: 0,
        csrf: '',
      },
    },
    afterHandle: AHS.J_D,
  },
  delFavoriteFolder: {
    url: 'https://api.bilibili.com/x/v3/fav/folder/del',
    _fetch: {
      method: 'post',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: {
        media_ids: '',
        csrf: '',
      },
    },
    afterHandle: AHS.J_D,
  },
  // 收藏夹拖拽排序。参数形状从 B 站空间页自己的主包里抠出来的
  // （fresh-space assets/index-*.js：POST /x/v3/fav/folder/sort，sort=完整新顺序逗号拼接，
  // 放 query 不放 body），已用「发送当前顺序」做过无副作用验证（code 0、顺序不变）
  sortFavoriteFolders: {
    url: 'https://api.bilibili.com/x/v3/fav/folder/sort',
    _fetch: {
      method: 'post',
    },
    params: {
      sort: '',
      csrf: '',
    },
    afterHandle: AHS.J_D,
  },
} satisfies APIMAP

export default API_FAVORITE
