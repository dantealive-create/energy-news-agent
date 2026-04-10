const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { NEWS_SOURCES } = require('./sources');

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';

function generateId(source, title) {
  const hash = Buffer.from(title || '').toString('base64').slice(0, 12);
  return `${source}_${hash}_${Date.now()}`;
}

async function searchNews(topic, sourceName, displayName, authorityScore) {
  try {
    console.log(`Searching: ${topic} (${sourceName})...`);

    const response = await axios.post(KIMI_API_URL, {
      model: 'moonshot-v1-128k',
      messages: [
        {
          role: 'system',
          content: `你是一个专业的能源市场新闻分析师。请根据搜索结果，提取原油、天然气相关的最新新闻。

只返回JSON数组，不要包含其他文字：
[
  {
    "title": "新闻标题",
    "summary": "摘要（100-200字）",
    "url": "原文链接",
    "publishTime": "发布时间",
    "category": ["price"],
    "importance": 8
  }
]

分类选项：geopolitics, price, supply, demand, policy, inventory, trading, analysis, new_plant, maintenance
重要性：地缘冲突/价格剧变/供应中断 8-10分，一般分析 5-7分。
只返回JSON数组。`
        },
        {
          role: 'user',
          content: `请搜索最新的${topic}相关新闻，提取5-8条最重要的，返回JSON数组。`
        }
      ],
      max_tokens: 4096,
      temperature: 0.3,
      tools: [
        {
          type: 'builtin_function',
          function: {
            name: '$web_search'
          }
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 180000
    });

    const content = response.data.choices[0].message.content;
    if (!content) {
      console.warn(`No content from ${sourceName}`);
      return { source: sourceName, items: [], success: false, error: 'No content' };
    }

    let newsItems;
    try {
      newsItems = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        newsItems = JSON.parse(jsonMatch[1].trim());
      } else {
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          newsItems = JSON.parse(arrayMatch[0]);
        } else {
          console.warn(`Parse error from ${sourceName}:`, content.slice(0, 200));
          return { source: sourceName, items: [], success: false, error: 'Parse error' };
        }
      }
    }

    if (!Array.isArray(newsItems)) {
      newsItems = newsItems.news || newsItems.items || newsItems.data || [];
    }

    for (const item of newsItems) {
      item.id = generateId(sourceName, item.title);
      item.source = { name: sourceName, displayName, authorityScore };
      item.authority = authorityScore;
      item.fetchTime = new Date().toISOString();
      if (!Array.isArray(item.category)) {
        item.category = item.category ? [item.category] : ['analysis'];
      }
    }

    console.log(`Got ${newsItems.length} items from ${sourceName}`);
    return { source: sourceName, items: newsItems, success: true };

  } catch (error) {
    const errMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`Error searching ${sourceName}:`, errMsg);
    return { source: sourceName, items: [], success: false, error: errMsg };
  }
}

async function crawlAllSources() {
  const searchTopics = [
    { topic: '原油价格走势 crude oil price', source: 'oil_price', display: '原油价格', score: 10 },
    { topic: '天然气价格 LNG市场', source: 'lng_market', display: '天然气/LNG', score: 10 },
    { topic: '石油地缘政治 OPEC 中东局势', source: 'geopolitics', display: '地缘政治', score: 9 },
    { topic: '炼厂检修 装置投产 石化', source: 'plant_news', display: '装置动态', score: 8 },
    { topic: 'energy market oil gas supply demand', source: 'intl_energy', display: 'International', score: 9 },
  ];

  const results = [];
  for (const t of searchTopics) {
    const result = await searchNews(t.topic, t.source, t.display, t.score);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return results;
}

function mergeAndSortNews(results) {
  let allNews = [];
  for (const result of results) {
    if (result.success && result.items) {
      allNews = allNews.concat(result.items);
    }
  }

  const seen = new Set();
  allNews = allNews.filter(item => {
    const key = (item.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  allNews.sort((a, b) => {
    const scoreA = (a.importance || 5) * (a.authority || 5);
    const scoreB = (b.importance || 5) * (b.authority || 5);
    return scoreB - scoreA;
  });

  return allNews.slice(0, 30);
}

function saveData(newsItems) {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const stats = { total: newsItems.length, byCategory: {}, bySource: {} };
  for (const item of newsItems) {
    if (item.category) {
      for (const cat of item.category) {
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      }
    }
    if (item.source) {
      const name = item.source.displayName || item.source.name;
      stats.bySource[name] = (stats.bySource[name] || 0) + 1;
    }
  }

  const data = {
    date: new Date().toISOString().split('T')[0],
    items: newsItems,
    summary: stats,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(dataDir, 'news.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
  return data;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting crawl...`);

  if (!KIMI_API_KEY) {
    console.error('ERROR: KIMI_API_KEY not set');
    process.exit(1);
  }

  const results = await crawlAllSources();
  const successCount = results.filter(r => r.success).length;
  console.log(`Sources: ${successCount}/${results.length} succeeded`);

  const topNews = mergeAndSortNews(results);
  const data = saveData(topNews);

  console.log(`Done. Saved ${topNews.length} news items.`);
  console.log('Stats:', JSON.stringify(data.summary, null, 2));
  return data;
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { main };
