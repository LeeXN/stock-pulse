/**
 * time.js - 统一处理交易所时间、本地时间和图表时间戳
 *
 * 行情接口通常返回没有时区信息的墙上时间（例如 2026-06-01 09:30）。
 * 这类时间必须结合市场时区解析，不能直接交给 new Date()。
 */
const TimeUtils = (() => {
  const MARKET_TIMEZONES = {
    SH: 'Asia/Shanghai',
    SZ: 'Asia/Shanghai',
    HK: 'Asia/Hong_Kong',
    US: 'America/New_York',
    JP: 'Asia/Tokyo',
    KR: 'Asia/Seoul',
    EU: 'Europe/London',
    CRYPTO: 'UTC'
  };

  const pad = value => String(value).padStart(2, '0');

  function isValidTimeZone(timeZone) {
    if (!timeZone) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format();
      return true;
    } catch (_) {
      return false;
    }
  }

  function getLocalTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }

  function getExchangeTimeZone(market) {
    return MARKET_TIMEZONES[String(market || '').toUpperCase()] || 'Asia/Shanghai';
  }

  function resolveTimeZone(market, settings = {}) {
    const mode = settings.timezoneMode || 'exchange';
    if (mode === 'local') return getLocalTimeZone();
    if (mode === 'custom' && isValidTimeZone(settings.timezone)) return settings.timezone;
    return getExchangeTimeZone(market);
  }

  function partsToObject(parts) {
    const out = {};
    for (const part of parts) {
      if (part.type !== 'literal') out[part.type] = part.value;
    }
    return out;
  }

  /** Return the timezone offset at an epoch in milliseconds. */
  function getOffsetMs(epochMs, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    });
    const p = partsToObject(formatter.formatToParts(new Date(epochMs)));
    const asUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), Number(p.second)
    );
    return asUtc - Math.floor(epochMs / 1000) * 1000;
  }

  /** Convert a wall-clock date/time in a named timezone to epoch milliseconds. */
  function zonedPartsToEpoch(parts, timeZone) {
    const utcGuess = Date.UTC(
      parts.year, parts.month - 1, parts.day,
      parts.hour || 0, parts.minute || 0, parts.second || 0
    );
    // Two passes handle DST transitions without requiring a timezone library.
    let epoch = utcGuess - getOffsetMs(utcGuess, timeZone);
    epoch = utcGuess - getOffsetMs(epoch, timeZone);
    return epoch;
  }

  function parseWallClock(value, timeZone) {
    const text = String(value || '').trim();
    const match = text.match(
      /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
    );
    if (!match) return 0;
    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] || 0),
      minute: Number(match[5] || 0),
      second: Number(match[6] || 0)
    };
    if (
      parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 ||
      parts.hour > 23 || parts.minute > 59 || parts.second > 59
    ) return 0;
    try {
      return zonedPartsToEpoch(parts, isValidTimeZone(timeZone) ? timeZone : 'UTC');
    } catch (_) {
      return 0;
    }
  }

  function parseToEpochSeconds(value, timeZone) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    }
    const text = String(value || '').trim();
    if (!text) return 0;
    // Explicit offsets/Z are unambiguous and should not be reinterpreted.
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(text)) {
      const parsed = Date.parse(text.replace(/\//g, '-'));
      return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
    }
    return Math.floor(parseWallClock(text, timeZone) / 1000);
  }

  function formatParts(epochSeconds, timeZone, options = {}) {
    const date = new Date(Number(epochSeconds) * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
      ...options
    });
    return partsToObject(formatter.formatToParts(date));
  }

  function getZonedParts(epochSeconds, timeZone) {
    return formatParts(epochSeconds, timeZone);
  }

  function formatTime(epochSeconds, timeZone, withSeconds = false) {
    const p = formatParts(epochSeconds, timeZone);
    if (!p) return '--';
    return `${pad(p.hour)}:${pad(p.minute)}${withSeconds ? ':' + pad(p.second) : ''}`;
  }

  function formatDate(epochSeconds, timeZone) {
    const p = formatParts(epochSeconds, timeZone);
    if (!p) return '--';
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }

  function formatDateTime(epochSeconds, timeZone) {
    const p = formatParts(epochSeconds, timeZone);
    if (!p) return '--';
    return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
  }

  function todayInputValue() {
    const timeZone = getLocalTimeZone();
    const p = formatParts(Date.now() / 1000, timeZone);
    return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : '';
  }

  function isWeekday(epochSeconds, timeZone) {
    try {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
        .format(new Date(Number(epochSeconds) * 1000));
      return weekday !== 'Sat' && weekday !== 'Sun';
    } catch (_) {
      return true;
    }
  }

  function isMarketTrading(epochSeconds, market) {
    const zone = getExchangeTimeZone(market);
    if (String(market || '').toUpperCase() === 'CRYPTO') return true;
    if (!isWeekday(epochSeconds, zone)) return false;
    const p = formatParts(epochSeconds, zone);
    if (!p) return false;
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    const sessions = {
      SH: [[570, 690], [780, 900]],
      SZ: [[570, 690], [780, 900]],
      HK: [[570, 720], [780, 960]],
      US: [[570, 960]],
      JP: [[540, 690], [750, 930]],
      KR: [[540, 930]],
      EU: [[480, 990]]
    }[String(market || '').toUpperCase()] || [[570, 900]];
    return sessions.some(([start, end]) => minutes >= start && minutes < end);
  }

  function formatAxisLabel(time, market, settings = {}) {
    if (typeof time === 'string') return time.length >= 10 ? time.slice(5, 10) : time;
    const timeZone = resolveTimeZone(market, settings);
    return formatTime(time, timeZone);
  }

  function formatCrosshairLabel(time, market, settings = {}) {
    if (typeof time === 'string') return time;
    const timeZone = resolveTimeZone(market, settings);
    return formatDateTime(time, timeZone);
  }

  function normalizeDate(value) {
    const text = String(value || '').trim();
    let match = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (!match) match = text.match(/^(\d{4})(\d{2})(\d{2})(?:$|\s)/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  return {
    MARKET_TIMEZONES,
    getLocalTimeZone,
    getExchangeTimeZone,
    resolveTimeZone,
    isValidTimeZone,
    parseToEpochSeconds,
    formatTime,
    formatDate,
    formatDateTime,
    getZonedParts,
    todayInputValue,
    isWeekday,
    isMarketTrading,
    formatAxisLabel,
    formatCrosshairLabel,
    normalizeDate
  };
})();
