import browser from 'webextension-polyfill'

interface Message {
  contentScriptQuery: string
  [key: string]: any
}

export enum TABS_MESSAGE {
  OPEN_LINK_IN_BACKGROUND = 'openLinkInBackground',
}

function handleMessage(message: Message) {
  if (message.contentScriptQuery === TABS_MESSAGE.OPEN_LINK_IN_BACKGROUND) {
    return browser.tabs.create({ url: message.url, active: false })
  }
}

export function setupTabMsgLstnrs() {
  browser.runtime.onMessage.removeListener(handleConnect)
  browser.runtime.onMessage.addListener(handleConnect)

  // `handleMessage` used to be registered only once some other message had already arrived, so
  // the first one was never answered. Register it at setup instead.
  browser.runtime.onMessage.removeListener(handleMessage)
  browser.runtime.onMessage.addListener(handleMessage)
}

function handleConnect() {
  browser.runtime.onMessage.removeListener(handleMessage)
  browser.runtime.onMessage.addListener(handleMessage)
}
