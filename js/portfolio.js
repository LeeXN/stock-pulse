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
    const portfolio = await DB.get('portfolio', []);
    // 查找已有持仓
    let pos = portfolio.find(p => p.fullCode === trade.fullCode);
    if (!pos) {
      pos = {
        fullCode: trade.fullCode,
        code: trade.code,
        name: trade.name,
        market: trade.market,
        trades: [],
        colorIndex: portfolio.length % this.COLORS.length
      };
      portfolio.push(pos);
    }
    pos.trades.push({
      id: Date.now().toString(36),
      direction: trade.direction,
      price: trade.price,
      quantity: trade.quantity,
      date: trade.date,
      note: trade.note || '',
      timestamp: Date.now()
    });
    await DB.set('portfolio', portfolio);
    return portfolio;
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

    for (const t of pos.trades) {
      if (t.direction === 'buy') {
        totalBuyQty += t.quantity;
        totalBuyCost += t.price * t.quantity;
      } else {
        totalSellQty += t.quantity;
        totalSellRevenue += t.price * t.quantity;
      }
    }

    const holdingQty = totalBuyQty - totalSellQty;
    const avgCost = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
    const marketValue = holdingQty * currentPrice;
    const costValue = holdingQty * avgCost;
    const pnl = marketValue - costValue + totalSellRevenue - (totalSellQty * avgCost);
    const pnlPercent = costValue > 0 ? ((marketValue - costValue) / costValue * 100) : 0;

    return {
      holdingQty,
      avgCost,
      marketValue,
      costValue,
      pnl,
      pnlPercent,
      totalBuyQty,
      totalSellQty,
      totalBuyCost,
      totalSellRevenue
    };
  },

  getColor(index) {
    return this.COLORS[index % this.COLORS.length];
  }
};
