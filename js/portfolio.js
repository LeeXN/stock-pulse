/**
 * portfolio.js - 持仓管理
 */
const Portfolio = {
  COLORS: [
    '#4fc3f7', '#e040fb', '#f0b90b', '#26a69a', '#ef5350',
    '#ff7043', '#66bb6a', '#ab47bc', '#29b6f6', '#ffa726'
  ],

  /**
   * 添加交易记录
   */
  async addTrade(trade) {
    const result = await this.addTrades([trade]);
    return result.portfolio;
  },

  /**
   * 批量添加交易。先在内存中完成全部校验，再一次性写入，避免导入到一半失败。
   */
  async addTrades(trades) {
    if (!Array.isArray(trades) || !trades.length) {
      return { portfolio: await DB.get('portfolio', []), added: 0, duplicates: 0 };
    }
    const stored = await DB.get('portfolio', []);
    const portfolio = (Array.isArray(stored) ? stored : []).map(pos => ({
      ...pos,
      trades: Array.isArray(pos.trades) ? pos.trades.map(t => ({ ...t })) : []
    }));
    let added = 0;
    let duplicates = 0;

    for (let index = 0; index < trades.length; index++) {
      const input = trades[index] || {};
      const fullCode = String(input.fullCode || '').trim().toUpperCase();
      const [marketFromCode, codeFromCode] = fullCode.split(':');
      const normalized = {
        ...input,
        fullCode,
        code: String(input.code || codeFromCode || '').trim(),
        market: String(input.market || marketFromCode || '').trim().toUpperCase(),
        direction: String(input.direction || '').toLowerCase(),
        price: Number(input.price),
        quantity: Number(input.quantity),
        date: String(input.date || '').trim(),
        time: String(input.time || '').trim(),
        commission: Number(input.commission || 0),
        stampTax: Number(input.stampTax || 0),
        note: String(input.note || '')
      };
      let pos = portfolio.find(p => p.fullCode === normalized.fullCode);

      if (normalized.dedupeKey && pos && pos.trades.some(t =>
        t.dedupeKey === normalized.dedupeKey || (!t.dedupeKey && this._sameTrade(t, normalized)))) {
        duplicates++;
        continue;
      }

      const validationError = this.validateTrade(normalized, pos);
      if (validationError) {
        throw new Error(`第 ${input.sourceLine || index + 1} 条交易无效：${validationError}`);
      }

      if (!pos) {
        pos = {
          fullCode: normalized.fullCode,
          code: normalized.code,
          name: normalized.name || normalized.code,
          market: normalized.market,
          trades: [],
          colorIndex: portfolio.length % this.COLORS.length
        };
        portfolio.push(pos);
      } else {
        if (!pos.name && normalized.name) pos.name = normalized.name;
        if (!pos.code && normalized.code) pos.code = normalized.code;
        if (!pos.market && normalized.market) pos.market = normalized.market;
      }

      pos.trades.push({
        id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${index}`,
        direction: normalized.direction,
        price: normalized.price,
        quantity: normalized.quantity,
        date: normalized.date,
        time: normalized.time,
        commission: normalized.commission,
        stampTax: normalized.stampTax,
        note: normalized.note,
        ...(normalized.dedupeKey ? { dedupeKey: String(normalized.dedupeKey) } : {}),
        timestamp: Number.isFinite(Number(normalized.timestamp)) ? Number(normalized.timestamp) : Date.now()
      });
      added++;
    }

    if (added > 0) await DB.set('portfolio', portfolio);
    return { portfolio, added, duplicates };
  },

  validateTrade(trade, pos) {
    if (!trade.fullCode || !/^[A-Z][A-Z0-9_]*:[^:]+$/.test(trade.fullCode)) return '缺少有效标的';
    if (!['buy', 'sell'].includes(trade.direction)) return '方向必须是买入或卖出';
    if (!Number.isFinite(trade.price) || trade.price <= 0) return '价格必须大于 0';
    if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) return '数量必须大于 0';
    if (!this._isValidDate(trade.date)) return '日期无效';
    if (!Number.isFinite(trade.commission) || trade.commission < 0) return '手续费不能为负数';
    if (!Number.isFinite(trade.stampTax) || trade.stampTax < 0) return '印花税不能为负数';
    if (trade.direction === 'sell' && pos) {
      const holdingQty = this.calcPosition(pos, 0).holdingQty;
      if (trade.quantity > holdingQty + 1e-9) {
        return `卖出数量超过当前持仓（可卖 ${holdingQty}）`;
      }
    } else if (trade.direction === 'sell' && !pos) {
      return '没有可卖出的持仓';
    }
    return '';
  },

  _sameTrade(left, right) {
    return String(left.direction || '') === right.direction &&
      Number(left.price) === right.price && Number(left.quantity) === right.quantity &&
      String(left.date || '') === right.date && String(left.time || '') === right.time &&
      Number(left.commission || 0) === right.commission &&
      Number(left.stampTax || 0) === right.stampTax &&
      String(left.note || '') === right.note;
  },

  _isValidDate(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  },

  /**
   * 删除交易记录
   */
  async deleteTrade(fullCode, tradeId) {
    const portfolio = await DB.get('portfolio', []);
    const pos = portfolio.find(p => p.fullCode === fullCode);
    if (pos) {
      pos.trades = pos.trades.filter(t => t.id !== tradeId);
      if (pos.trades.length === 0) {
        const idx = portfolio.indexOf(pos);
        portfolio.splice(idx, 1);
      }
    }
    await DB.set('portfolio', portfolio);
    return portfolio;
  },

  /**
   * 删除整个持仓
   */
  async deletePosition(fullCode) {
    let portfolio = await DB.get('portfolio', []);
    portfolio = portfolio.filter(p => p.fullCode !== fullCode);
    await DB.set('portfolio', portfolio);
    return portfolio;
  },

  /**
   * 计算持仓汇总
   */
  calcPosition(pos, currentPrice) {
    let totalBuyQty = 0, totalSellQty = 0;
    let totalBuyCost = 0, totalSellRevenue = 0;
    let totalCommission = 0, totalStampTax = 0;

    for (const t of pos.trades) {
      const price = Number(t.price) || 0;
      const quantity = Number(t.quantity) || 0;
      if (t.direction === 'buy') {
        totalBuyQty += quantity;
        totalBuyCost += price * quantity + (Number(t.commission) || 0);
      } else {
        totalSellQty += quantity;
        totalSellRevenue += price * quantity - (Number(t.commission) || 0) - (Number(t.stampTax) || 0);
      }
      totalCommission += Number(t.commission) || 0;
      totalStampTax += Number(t.stampTax) || 0;
    }

    const holdingQty = totalBuyQty - totalSellQty;
    const avgCost = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
    const marketValue = holdingQty * currentPrice;
    const costValue = holdingQty * avgCost;
    const pnl = marketValue - costValue + totalSellRevenue - (totalSellQty * avgCost);
    const unrealizedPnl = marketValue - costValue;
    const unrealizedPnlPercent = costValue > 0 ? (unrealizedPnl / costValue * 100) : 0;
    // 持仓收益率采用累计买入成本作为投入基数，包含已实现收益和交易费用。
    const pnlPercent = totalBuyCost > 0 ? (pnl / totalBuyCost * 100) : 0;

    return {
      holdingQty,
      avgCost,
      marketValue,
      costValue,
      pnl,
      pnlPercent,
      unrealizedPnl,
      unrealizedPnlPercent,
      totalBuyQty,
      totalSellQty,
      totalBuyCost,
      totalSellRevenue,
      totalCommission,
      totalStampTax
    };
  },

  getColor(index) {
    return this.COLORS[index % this.COLORS.length];
  }
};
