/**
 * background.js - Service worker
 *
 * 职责：
 *   1. 点击图标打开 Side Panel
 *   2. 注册右键菜单（选中股票代码时显示「加入 Stock Pulse」）
 *   3. 定时更新浏览器角标（涨跌股数）
 *   5. 处理来自 panel 的消息：添加股票 / 打开东财 / 弹窗 / LLM 中转
 *   6. 防止 service worker 被回收
 */
const KEEP_ALIVE_ALARM = 'sp_keep_alive';
const BADGE_ALARM = 'sp_badge_update';
const TC_BASE = 'https://qt.gtimg.cn/q=';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });

  registerContextMenus();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  registerContextMenus();
  updateBadge();
});

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'sp_add_watchlist',
      title: '加入 Stock Pulse 自选股',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'sp_open_eastmoney',
      title: '在东方财富查看详情',
      contexts: ['selection']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || '').trim();
  if (!text) return;

  if (info.menuItemId === 'sp_open_eastmoney' || info.menuItemId === 'sp_add_watchlist') {
    const parsed = parseStockCode(text);
    if (!parsed) return;
    if (info.menuItemId === 'sp_add_watchlist') {
      await addToWatchlistViaMessage(parsed);
    } else {
      openEastmoney(parsed);
    }
  }
});

/**
 * 从一段文本中解析出第一个可识别的股票代码
 */
function parseStockCode(text) {
  text = text.trim();
  let m = text.match(/^(SH|SZ|HK|sh|sz|hk)\s*[.\-]?\s*(\d{4,6})/);
  if (m) {
    const market = m[1].toUpperCase();
    let code = m[2];
    if (market === 'HK') code = code.padStart(5, '0');
    return { code, market, fullCode: `${market}:${code}` };
  }
  m = text.match(/^(\d{4,6})\s*\.\s*(SH|SZ|HK|sh|sz|hk)$/);
  if (m) {
    let code = m[1];
    const market = m[2].toUpperCase();
    if (market === 'HK') code = code.padStart(5, '0');
    return { code, market, fullCode: `${market}:${code}` };
  }
  const digits = text.replace(/[^\d]/g, '');
  if (/^[036]\d{5}$/.test(digits)) {
    const market = digits.startsWith('6') ? 'SH' : 'SZ';
    return { code: digits, market, fullCode: `${market}:${digits}` };
  }
  if (/^0\d{4}$/.test(digits)) {
    return { code: digits, market: 'HK', fullCode: `HK:${digits}` };
  }
  return null;
}

async function addToWatchlistViaMessage(stock) {
  const tcCode = stock.market === 'HK' ? 'hk' + stock.code : stock.market.toLowerCase() + stock.code;
  try {
    const resp = await fetch(TC_BASE + tcCode);
    const text = await resp.text();
    const match = text.match(/v_[a-z]{2}\d+="(.+)"/);
    let name = stock.code;
    if (match) {
      const parts = match[1].split('~');
      if (parts[1]) name = parts[1];
    }
    const stockWithName = { ...stock, name };
    chrome.runtime.sendMessage({ type: 'sp:add-watchlist', stock: stockWithName }).catch(() => {});
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'sp:add-watchlist', stock }).catch(() => {});
  }
}

function openEastmoney(stock) {
  let url;
  if (stock.market === 'HK') {
    url = `https://quote.eastmoney.com/hk/${stock.code}.html`;
  } else {
    const prefix = stock.market === 'SH' ? '1' : '0';
    url = `https://quote.eastmoney.com/${prefix === '1' ? 'sh' : 'sz'}${stock.code}.html`;
  }
  chrome.tabs.create({ url });
}

/**
 * 在独立窗口中打开 panel（可调大小）
 */
function openPanelWindow() {
  const url = chrome.runtime.getURL('panel.html?windowed=1');
  chrome.windows.create({ url, type: 'normal', width: 480, height: 820 });
}

/**
 * 监听来自 panel 的消息
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'sp:open-eastmoney') {
    openEastmoney(msg.stock);
    sendResponse({ ok: true });
  } else if (msg.type === 'sp:open-window') {
    openPanelWindow();
    sendResponse({ ok: true });
  } else if (msg.type === 'sp:fetch-quotes') {
    fetchQuotes(msg.codes).then(quotes => sendResponse({ quotes }));
    return true;
  } else if (msg.type === 'sp:llm-chat') {
    // LLM 调用统一在 background（service worker 比 panel 寿命长）
    callLLM(msg.payload).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
    return true;
  } else if (msg.type === 'sp:fetch-url') {
    // 通用 fetch 中转（避免 CORS），返回 JSON
    fetch(msg.url, { signal: AbortSignal.timeout(15000) })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(data => sendResponse({ data }))
      .catch(e => sendResponse({ error: e.message || String(e) }));
    return true;
  }
});

/**
 * 拉取一组代码的实时报价
 */
async function fetchQuotes(fullCodes) {
  if (!fullCodes || !fullCodes.length) return {};
  const tcCodes = fullCodes.map(c => {
    const [m, code] = c.split(':');
    if (m === 'HK') return 'hk' + code;
    return m.toLowerCase() + code;
  });
  try {
    const resp = await fetch(TC_BASE + tcCodes.join(','));
    const buf = await resp.arrayBuffer();
    let text;
    try { text = new TextDecoder('gbk').decode(buf); } catch (_) { text = new TextDecoder('utf-8').decode(buf); }
    const results = {};
    for (const line of text.split(';')) {
      const m = line.match(/v_([a-z]{2})(\d+)="(.+)"/);
      if (!m) continue;
      const [, prefix, code, dataStr] = m;
      const p = dataStr.split('~');
      if (p.length < 5) continue;
      let market = 'SZ';
      if (prefix === 'sh') market = 'SH';
      else if (prefix === 'hk') market = 'HK';
      const fullCode = `${market}:${code}`;
      if (prefix === 'hk') {
        results[fullCode] = {
          fullCode, code, market,
          name: p[1],
          price: parseFloat(p[3]) || 0,
          prevClose: parseFloat(p[4]) || 0,
          change: parseFloat(p[31]) || 0,
          changePercent: parseFloat(p[32]) || 0
        };
      } else {
        results[fullCode] = {
          fullCode, code, market,
          name: p[1],
          price: parseFloat(p[3]) || 0,
          prevClose: parseFloat(p[4]) || 0,
          change: parseFloat(p[31]) || 0,
          changePercent: parseFloat(p[32]) || 0
        };
      }
    }
    return results;
  } catch (e) {
    console.error('[bg] fetchQuotes failed:', e);
    return {};
  }
}

/**
 * 定时检查预警
 */
/**
 * 更新浏览器角标：红色 = 涨的股数，绿色 = 跌的股数
 */
async function updateBadge() {
  try {
    const { watchlist = [], portfolio = [] } = await chrome.storage.local.get(['watchlist', 'portfolio']);
    const all = [...watchlist, ...portfolio];
    if (!all.length) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    const codes = [...new Set(all.map(s => s.fullCode))];
    const quotes = await fetchQuotes(codes);
    let up = 0, down = 0;
    for (const s of all) {
      const q = quotes[s.fullCode];
      if (!q) continue;
      if (q.change > 0) up++;
      else if (q.change < 0) down++;
    }
    if (up > down && up > 0) {
      chrome.action.setBadgeText({ text: '↑' + up });
      chrome.action.setBadgeBackgroundColor({ color: '#ef5350' });
    } else if (down > up && down > 0) {
      chrome.action.setBadgeText({ text: '↓' + down });
      chrome.action.setBadgeBackgroundColor({ color: '#26a69a' });
    } else {
      chrome.action.setBadgeText({ text: String(all.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#4fc3f7' });
    }
  } catch (e) {
    console.warn('[bg] updateBadge failed:', e);
  }
}

/**
 * LLM 中转 - 统一在 service worker 中调用，避免面板关闭导致 fetch 取消
 * 出错时抛出带分类提示的 Error，UI 层可直接展示
 */
async function callLLM(payload) {
  const { baseUrl, apiKey, model, messages, temperature, maxTokens, corsProxy } = payload || {};
  if (!baseUrl) throw new Error('未配置 LLM Base URL');
  if (!apiKey) throw new Error('未配置 LLM API Key');
  if (!model) throw new Error('未配置 LLM Model');

  // 1) URL 预检
  let url;
  try {
    const cleaned = baseUrl.replace(/\/+$/, '');
    url = cleaned + '/chat/completions';
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) {
      throw new Error('Base URL 协议必须是 http:// 或 https://，当前是 ' + u.protocol);
    }
  } catch (e) {
    if (e instanceof TypeError && /Invalid URL/i.test(e.message)) {
      throw new Error('Base URL 格式不合法：' + baseUrl + '\n示例：https://api.openai.com/v1');
    }
    throw e;
  }

  const body = {
    model,
    messages,
    temperature: temperature ?? 0.5,
    max_tokens: maxTokens ?? 1500
  };

  // 2) 实际调用（带 30s 超时 + 可选 CORS 代理）
  const controller = new AbortController();
  const timeoutMs = 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const { url: realUrl, viaProxy } = _applyCorsProxy(url, corsProxy);

  let resp;
  try {
    resp = await fetch(realUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const errMsg = _classifyFetchError(err, realUrl, timeoutMs);
    if (viaProxy) {
      throw new Error(errMsg + '\n\n（请求通过 CORS 代理发出：' + corsProxy + '）\n' +
        '请检查：① 代理服务是否在线 ② 代理是否需要鉴权 token ③ 代理是否正确转发 Authorization / Body');
    }
    throw new Error(errMsg);
  }
  clearTimeout(timer);

  // 3) HTTP 状态码
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(_httpErrorHint(resp.status, resp.statusText, text, baseUrl));
  }

  // 4) 解析 JSON
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('LLM 返回不是 JSON（可能被代理劫持、Base URL 拼错、或返回了登录页）\n\n返回前 300 字：\n' + text.slice(0, 300));
  }
  if (data.error) {
    const m = (data.error && (data.error.message || data.error.code)) || JSON.stringify(data.error);
    throw new Error('LLM 返回错误：' + m);
  }
  // 精细化诊断空响应
  const snippet = JSON.stringify(data).slice(0, 500);
  if (!data.choices || data.choices.length === 0) {
    throw new Error('【choices 为空】LLM 没有返回任何 choices\n\n' +
      '可能原因：\n' +
      '1) 模型名拼错 / 模型已下线（当前：' + model + '）\n' +
      '2) 内容被服务端安全过滤（prompt 含敏感词）\n' +
      '3) 服务端返回了非标准格式\n\n' +
      '响应片段：\n' + snippet);
  }
  const choice = data.choices[0];
  const finish = choice.finish_reason || '(未知)';
  const refusal = (choice.message && (choice.message.refusal || choice.message.refusal_reason)) || '';
  const content = choice.message && choice.message.content;
  const usage = data.usage || null;
  // null/undefined → 真正缺失；空字符串 → 模型响应了但没输出（推理模型 token 不够等）
  if (content == null) {
    throw new Error('【content 为空】choices[0] 有返回但 message.content 为 null\n\n' +
      'finish_reason: ' + finish +
      (refusal ? '\n拒绝原因(refusal): ' + refusal : '') +
      '\n模型: ' + model +
      (finish === 'length' ? '\n\n提示：token 用完了。把 max_tokens 调大，或缩短上下文' : '') +
      (finish === 'content_filter' ? '\n\n提示：输出触发了内容过滤。换个 prompt 或模型试试' : '') +
      (finish === 'tool_calls' ? '\n\n提示：模型想调用工具但本扩展不支持 function calling，请用纯文本模型' : '') +
      '\n\nchoice 片段：\n' + JSON.stringify(choice).slice(0, 400));
  }
  return { content: content || '', usage };
}

/**
 * 把 fetch 抛出的 "Failed to fetch" 翻译成可读分类
 */

/**
 * 如果用户配置了 CORS 代理，把原 URL 编码后拼到代理前缀上
 * 约定：代理形如 https://my-proxy.workers.dev/?url=
 * 代理服务器收到 ?url= 后，原样转发请求并把响应原样返回（带 CORS 头）
 */
function _applyCorsProxy(originalUrl, proxyPrefix) {
  if (!proxyPrefix || !proxyPrefix.trim()) {
    return { url: originalUrl, viaProxy: false };
  }
  const trimmed = proxyPrefix.trim();
  // 兼容性：如果用户填的代理末尾没有 = 或 ?，自动补一个 ?url=
  let prefix = trimmed;
  if (!/[?&]url=$/.test(prefix)) {
    if (prefix.includes('?')) {
      // 已有其他 query 参数，把 url= 追加进去
      if (/[?&]$/.test(prefix)) {
        prefix = prefix + 'url=';
      } else {
        prefix = prefix + '&url=';
      }
    } else {
      prefix = prefix + '?url=';
    }
  }
  return { url: prefix + encodeURIComponent(originalUrl), viaProxy: true };
}

function _classifyFetchError(err, url, timeoutMs) {
  // 1) 超时
  if (err && err.name === 'AbortError') {
    return '【请求超时】超过 ' + Math.round(timeoutMs / 1000) + ' 秒未响应。\n\n' +
      '可能原因：\n' +
      '1) 厂商服务慢 / 排队中（OpenAI 高峰期常见）\n' +
      '2) 网络需要走代理，但本机代理没开\n' +
      '3) Base URL 拼错，落到了一个能连但永远不响应的 IP\n\n' +
      '当前 URL：' + url;
  }

  // 2) 抓 Chrome 内部 net::ERR_* 码
  const haystack = (String(err && err.cause || '') + ' ' + String(err && err.message || '')).trim();
  const codeMatch = haystack.match(/ERR_[A-Z_0-9]+/);
  const code = codeMatch ? codeMatch[0] : '';
  const codeHints = {
    'ERR_NAME_NOT_RESOLVED':   'DNS 解析失败：域名拼错、或本机 hosts/DNS 把这个域名挡了。\n试试在浏览器直接打开 ' + url,
    'ERR_CONNECTION_REFUSED':  '连接被拒绝：目标端口没人在听。常见：①Base URL 端口写错 ②自建代理没起来',
    'ERR_CONNECTION_TIMED_OUT':'连接超时：网络慢或被丢包',
    'ERR_INTERNET_DISCONNECTED':'本机断网',
    'ERR_NETWORK_CHANGED':     '网络环境刚切换，重试一次',
    'ERR_SSL_PROTOCOL_ERROR':  'SSL/TLS 握手失败：目标站点证书异常，或本机系统时间不准',
    'ERR_CERT_':               '证书错误：检查系统时间 / 目标证书是否过期',
    'ERR_BLOCKED_BY_CLIENT':   '被浏览器或扩展拦截：检查是否启用了 AdGuard/uBlock/代理类扩展',
    'ERR_ABORTED':             '请求被中断：可能是 service worker 被回收，稍后重试',
    'ERR_UNSAFE_PORT':         '浏览器把端口列为不安全（常见：5000、8080 等开发端口）',
    'ERR_TOO_MANY_REDIRECTS':  '重定向死循环：Base URL 是某个登录跳转页',
    'ERR_EMPTY_RESPONSE':      '服务器关闭了连接且没返回任何数据'
  };
  if (code && codeHints[code]) {
    return '【网络错误】Chrome 错误码 ' + code + '\n' + codeHints[code];
  }
  if (code) {
    return '【网络错误】Chrome 错误码 ' + code + '\n' + (err.message || 'fetch 失败');
  }

  // 3) 没有 cause 也没有 ERR_* 码 → 经典 CORS
  if (/Failed to fetch/i.test(haystack) || !haystack) {
    let origin = '';
    try { origin = new URL(url).origin; } catch (e) {}
    return '【请求被拦截：最可能是 CORS / 跨域】\n' +
      'fetch 没有拿到响应（连 HTTP 状态码都没有），十有八九是浏览器跨域检查没通过。\n\n' +
      '注意：manifest.json 的 host_permissions 不决定 fetch 能不能发出去（service worker 可以请求任意 URL），' +
      '决定成败的是**服务器是否返回了 CORS 响应头**。\n\n' +
      '排查清单：\n' +
      '1) 在终端 curl 同一个 URL，curl 默认不走 CORS 校验。能看到 200 + JSON 就证明网络/API Key 都正常，问题在 CORS：\n' +
      '   curl -i -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\\n' +
      '     -d \'{"model":"...","messages":[{"role":"user","content":"hi"}]}\' \\\n' +
      '     ' + url + '\n' +
      '   看响应里有没有 access-control-allow-origin 头\n' +
      '2) 海外厂商（OpenAI/NVIDIA/Anthropic）在国内直连会被运营商 RST。换个能直连的厂商（DeepSeek/Qwen/Moonshot），或用 OpenRouter 这类支持自定义代理的网关\n' +
      '3) 如果用了自建反向代理，确认代理出站带了 CORS 头：\n' +
      '   Access-Control-Allow-Origin: *\n' +
      '   Access-Control-Allow-Headers: authorization,content-type\n' +
      '4) 如果是 Gemini 这类非 OpenAI 协议厂商，请确认 Base URL 拼对了 gateway 路径\n\n' +
      '当前 URL：' + url;
  }

  // 4) 兜底
  return '【未知网络错误】' + (err.message || String(err)) + '\n当前 URL：' + url;
}

/**
 * HTTP 4xx/5xx 状态码提示
 */
function _httpErrorHint(status, statusText, body, baseUrl) {
  const snippet = (body || '').slice(0, 300).replace(/\s+/g, ' ');
  const lowerBody = (body || '').toLowerCase();
  const tail = '\n\n服务器返回前 300 字：\n' + snippet;
  if (status === 401) {
    return '【HTTP 401 未授权】API Key 不对 / 过期 / 被吊销。\n检查设置里的「LLM API Key」。' + tail;
  }
  if (status === 403) {
    return '【HTTP 403 禁止】最常见原因：\n' +
      '1) Key 没启用该模型（部分厂商按模型授权）\n' +
      '2) 地区封锁：OpenAI/Anthropic 在中国大陆直接调用经常拿到 403\n' +
      '3) 余额不足 / 欠费\n' +
      '4) 模型名拼错，部分厂商对未授权模型返回 403 而不是 404' + tail;
  }
  if (status === 404) {
    if (/no endpoints found that support image input/i.test(body || '') ||
        /support image input/.test(lowerBody) ||
        /does not support image/.test(lowerBody)) {
      return '【HTTP 404 模型不支持图片输入】\n' +
        '当前请求不是 Base URL 路径错误，而是所选模型不支持 `image_url` / 图片输入。\n' +
        '如果你是在走 OCR，请到 设置 → AI / 大模型，把「视觉模型」改成支持图片输入的模型。\n' +
        'OpenRouter 的 Base URL 应保持为 https://openrouter.ai/api/v1。\n' +
        '可先尝试：openai/gpt-4o-mini' + tail;
    }
    return '【HTTP 404 路径不存在】\n' +
      '本扩展会自动在 Base URL 后面拼 /chat/completions。\n' +
      '如果 Base URL 形如 https://api.openai.com（没有 /v1），最终请求的是 ' + baseUrl.replace(/\/+$/, '') + '/chat/completions，而正确路径是 ' + baseUrl.replace(/\/+$/, '') + '/v1/chat/completions。\n' +
      '把 Base URL 改成 https://api.openai.com/v1 即可。' + tail;
  }
  if (status === 429) {
    return '【HTTP 429 限流】请求太快或配额用完。\n' +
      '处理：①稍等 30s 再试 ②换更便宜的模型 ③检查厂商账户的 RPM/TPM 配额' + tail;
  }
  if (status === 400) {
    return '【HTTP 400 请求格式错】可能是：\n' +
      '1) 模型名 model 不被该厂商识别\n' +
      '2) messages 格式不符合 OpenAI 协议（Gemini 网关经常对 system 字段有特殊要求）\n' +
      '3) temperature / max_tokens 越界' + tail;
  }
  if (status >= 500) {
    return '【HTTP ' + status + ' 服务端异常】' + statusText + '\n稍后重试。' + tail;
  }
  return '【HTTP ' + status + ' ' + statusText + '】' + tail;
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === BADGE_ALARM) {
    updateBadge();
  }
});
