const NEWS_SOURCES = [
  {
    name: 'argus',
    displayName: 'Argus Media',
    type: 'international',
    url: 'https://www.argusmedia.com/en/news',
    authorityScore: 10,
    enabled: true
  },
  {
    name: 'platts',
    displayName: 'S&P Global Platts',
    type: 'international',
    url: 'https://www.spglobal.com/commodityinsights/en/market-insights/latest-news',
    authorityScore: 10,
    enabled: true
  },
  {
    name: 'reuters_energy',
    displayName: 'Reuters Energy',
    type: 'international',
    url: 'https://www.reuters.com/business/energy/',
    authorityScore: 9,
    enabled: true
  },
  {
    name: 'bloomberg_energy',
    displayName: 'Bloomberg Energy',
    type: 'international',
    url: 'https://www.bloomberg.com/energy',
    authorityScore: 9,
    enabled: true
  },
  {
    name: 'yahoo_finance',
    displayName: 'Yahoo Finance Energy',
    type: 'financial',
    url: 'https://finance.yahoo.com/sectors/energy/',
    authorityScore: 8,
    enabled: true
  },
  {
    name: 'cnbc_energy',
    displayName: 'CNBC Energy',
    type: 'financial',
    url: 'https://www.cnbc.com/energy/',
    authorityScore: 8,
    enabled: true
  },
  {
    name: 'sina_finance',
    displayName: '新浪财经-原油',
    type: 'domestic',
    url: 'https://finance.sina.com.cn/futuremarket/oilroll.html',
    authorityScore: 7,
    enabled: true
  },
  {
    name: 'longzhong',
    displayName: '隆众资讯',
    type: 'domestic',
    url: 'https://www.oilchem.net/news/',
    authorityScore: 8,
    enabled: true
  }
];

module.exports = { NEWS_SOURCES };
