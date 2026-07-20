#!/usr/bin/env node
/*
 * Board Game Price Tracker - full-list scraper (turnkey)
 * Updates data.json in place: international prices (5 countries) + India price + FX.
 * Never touches the game list, your per-game discounts, notes, or status.
 *
 * Run:  node scraper.js            (Node 18+ for global fetch)
 * CI :  see .github/workflows/update-prices.yml
 *
 * For each game it will:
 *   1. resolve a missing bgoId from the game name (best-effort), then
 *   2. read the 5 country prices from Board Game Oracle, and
 *   3. read the India price from its Board Games India product page (meta tags).
 * Anything it cannot read is left null - it never invents a price.
 */
const fs = require('fs');
const PATH = process.env.DATA_PATH || './data.json';
const LOCALE = { USA:'', UK:'/en-GB', Canada:'/en-CA', Australia:'/en-AU', NZ:'/en-NZ' };
const UA = { 'User-Agent':'Mozilla/5.0 (compatible; bgpt-scraper/1.0)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries){
  tries = tries || 2;
  for (let i=0;i<tries;i++){
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 20000);
      const r = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return await r.text();
      if (r.status===404) return null;
    }catch(e){ /* retry */ }
    await sleep(1500);
  }
  return null;
}

// ---- resolve a BoardGameOracle id from a game name (best-effort) ----
async function resolveBgoId(name){
  const q = encodeURIComponent(name);
  const html = await get('https://www.boardgameoracle.com/boardgame/search?q='+q);
  if (!html) return null;
  // pick the first product link; prefer an exact-ish slug match
  const re = /\/boardgame\/price\/([A-Za-z0-9_-]{6,})\/([a-z0-9-]+)/g;
  const want = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  let m, first=null, exact=null;
  while ((m = re.exec(html))){
    if (!first) first = m[1];
    if (m[2] === want) { exact = m[1]; break; }
  }
  return exact || first;
}

// ---- Board Game Oracle: lowest in-stock price in one locale ----
function parseBGO(html){
  if (!html) return { price:null, stock:null };
  const a = html.search(/All prices in/i);
  const b = html.search(/Some links contain affiliate/i);
  const sec = (a>=0) ? html.slice(a, b>a?b:html.length) : html;
  // offers carry a price like $46.99 / £39.95 and an availability word nearby
  const re = /([$£€]|C\$|A\$|NZ\$)\s?([0-9][0-9,]*\.?[0-9]{0,2})[\s\S]{0,500}?(In stock|Out of stock|See store)/gi;
  let m, inStock=[], all=[];
  while ((m = re.exec(sec))){
    const v = parseFloat(m[2].replace(/,/g,''));
    if (!isFinite(v) || v<=0) continue;
    all.push(v);
    if (/in stock/i.test(m[3])) inStock.push(v);
  }
  if (inStock.length) return { price: Math.min(...inStock), stock:'In stock' };
  if (all.length)     return { price: Math.min(...all),     stock:'Out of stock' };
  return { price:null, stock:null };
}
async function scrapeBGO(bgoId, slug){
  const out = { prices:{}, stock:{} };
  const sl = slug || 'x';
  for (const [country, loc] of Object.entries(LOCALE)){
    const html = await get('https://www.boardgameoracle.com'+loc+'/boardgame/price/'+bgoId+'/'+sl);
    const { price, stock } = parseBGO(html);
    out.prices[country] = price; out.stock[country] = stock;
    await sleep(1000);
  }
  return out;
}

// ---- India: price + availability from a product page's meta tags ----
function meta(html, prop){
  if (!html) return null;
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']'+prop+'["\'][^>]+content=["\']([^"\']+)["\']','i');
  const m = html.match(re); return m ? m[1] : null;
}
async function scrapeIndia(url){
  const html = await get(url);
  if (!html) return null;
  const sale = meta(html,'product:sale_price:amount') || meta(html,'product:price:amount') || meta(html,'og:price:amount');
  const avail = (meta(html,'og:availability') || meta(html,'product:availability') || '').toLowerCase();
  const price = sale ? parseFloat(String(sale).replace(/[^0-9.]/g,'')) : null;
  if (price==null || !isFinite(price) || price<=0) return null;
  const stock = /instock|in stock/.test(avail) ? 'In stock' : (avail || '');
  return { price, source:'Board Games India', stock };
}

// ---- FX to INR (frankfurter, ECB-based, no key; fallback keeps existing) ----
async function fetchFX(existing){
  const html = await get('https://api.frankfurter.app/latest?from=INR&to=USD,GBP,CAD,AUD,NZD');
  try{
    const j = JSON.parse(html); const r = j.rates;
    const inv = x => Math.round((1/x)*100)/100;   // INR per 1 unit
    const fx = { USD:inv(r.USD), GBP:inv(r.GBP), CAD:inv(r.CAD), AUD:inv(r.AUD), NZD:inv(r.NZD) };
    for (const k of Object.keys(fx)) if (!isFinite(fx[k]) || fx[k]<=0) return existing;
    return fx;
  }catch(e){ return existing; }
}

(async function main(){
  const data = JSON.parse(fs.readFileSync(PATH,'utf8'));
  data.meta.fx = await fetchFX(data.meta.fx);
  data.meta.updated = new Date().toISOString().slice(0,10);

  let processed=0, intlPriced=0, indiaPriced=0, idsResolved=0, stillNoId=0;
  const newIds = [];
  for (const g of data.games){
    if (g.status==='Purchased' || g.status==='Dropped') continue;

    if (!g.bgoId){
      const id = await resolveBgoId(g.name);
      if (id){ g.bgoId = id; idsResolved++; newIds.push(g.name+' -> '+id); await sleep(800); }
    }
    if (g.bgoId){
      const slug = (g.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      const r = await scrapeBGO(g.bgoId, slug);
      g.prices = r.prices; g.stock = r.stock;
      if (Object.values(r.prices).some(v => v!=null)) intlPriced++;
    } else { stillNoId++; }

    if (g.indiaUrl){
      const ind = await scrapeIndia(g.indiaUrl);
      if (ind){ g.india = ind; indiaPriced++; }
    }

    processed++;
    if (processed % 10 === 0) console.log('  ...'+processed+'/'+data.games.length);
  }

  fs.writeFileSync(PATH, JSON.stringify(data, null, 1));
  console.log('Done. Processed '+processed+' games.');
  console.log('  International prices found : '+intlPriced);
  console.log('  India prices found        : '+indiaPriced);
  console.log('  BGO IDs auto-resolved      : '+idsResolved+(newIds.length?'  ('+newIds.slice(0,20).join(', ')+(newIds.length>20?' …':'')+')':''));
  console.log('  Still missing a BGO ID     : '+stillNoId);
  if (intlPriced===0) console.log('  NOTE: 0 international prices - Board Game Oracle markup may have changed; check parseBGO().');
})();
