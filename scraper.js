#!/usr/bin/env node
/*
 * Board Game Price Tracker - scraper (v2)
 * Updates data.json: international prices (5 countries) + India price + FX.
 * Never touches the game list, discounts, notes or status.
 * Run: node scraper.js     CI: .github/workflows/update-prices.yml
 */
const fs = require('fs');
const PATH = process.env.DATA_PATH || './data.json';
const LOCALE = { USA:'', UK:'/en-GB', Canada:'/en-CA', Australia:'/en-AU', NZ:'/en-NZ' };
const UA = { 'User-Agent':'Mozilla/5.0 (compatible; bgpt-scraper/2.0)' };
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
    }catch(e){}
    await sleep(1500);
  }
  return null;
}

// ---- Board Game Oracle ----
// Primary: read the Next.js __NEXT_DATA__ JSON blob and find offer prices.
function nextData(html){
  const m = html && html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch(e){ return null; }
}
// Offers are BGO's trpc "items" (~10 levels deep): {price, currency, availability:'in_stock'|'out_of_stock', merchant}
function findOffers(root){
  const out = [];
  (function walk(n){
    if (!n || typeof n!=='object') return;
    if (Array.isArray(n)){ n.forEach(walk); return; }
    if (typeof n.price==='number' && n.price>0 && ('availability' in n || 'merchant' in n)){
      let price = n.price;
      if (price>3000 && Number.isInteger(price)) price = price/100; // cents guard
      const av = String(n.availability||'').toLowerCase();
      out.push({ price:price, inStock: av.indexOf('in_stock')>=0 && av.indexOf('out')<0 });
    }
    Object.keys(n).forEach(function(k){ walk(n[k]); });
  })(root);
  return out;
}
// Precomputed lowest_price in price_stats, as a fallback.
function findLowest(root){
  let best=null;
  (function walk(n){
    if (!n || typeof n!=='object') return;
    if (typeof n.lowest_price==='number' && n.lowest_price>0){ if (best==null || n.lowest_price<best) best=n.lowest_price; }
    if (Array.isArray(n)) n.forEach(walk); else Object.keys(n).forEach(function(k){ walk(n[k]); });
  })(root);
  return best;
}
function parseBGO(html){
  if (!html) return { price:null, stock:null };
  const nd = nextData(html);
  if (nd){
    const offers = findOffers(nd);
    if (offers.length){
      const inS = offers.filter(function(o){return o.inStock;}).map(function(o){return o.price;});
      if (inS.length) return { price: Math.min.apply(null,inS), stock:'In stock' };
      return { price: Math.min.apply(null,offers.map(function(o){return o.price;})), stock:'Out of stock' };
    }
    const low = findLowest(nd);
    if (low!=null) return { price: low, stock:'' };
  }
  // Fallback: currency-prefixed numbers within the prices section (lenient)
  const a = html.search(/All prices in/i);
  const b = html.search(/affiliate/i);
  if (a>=0){
    const sec = html.slice(a, b>a?b:html.length);
    const re = /([$£€]|C\$|A\$|NZ\$)\s?([0-9][0-9,]*\.[0-9]{2})/g;
    let m, vals=[];
    while ((m = re.exec(sec))){ const v=parseFloat(m[2].replace(/,/g,'')); if (isFinite(v)&&v>3&&v<2000) vals.push(v); }
    if (vals.length) return { price: Math.min.apply(null,vals), stock:'' };
  }
  return { price:null, stock:null };
}
async function scrapeBGO(bgoId, slug){
  const out = { prices:{}, stock:{} };
  const sl = slug || 'x';
  for (const [country, locp] of Object.entries(LOCALE)){
    const html = await get('https://www.boardgameoracle.com'+locp+'/boardgame/price/'+bgoId+'/'+sl);
    const r = parseBGO(html);
    out.prices[country] = r.price; out.stock[country] = r.stock;
    await sleep(1000);
  }
  return out;
}
// Resolve a BGO id from a name - STRICT: only accept an exact slug match.
async function resolveBgoId(name){
  const html = await get('https://www.boardgameoracle.com/boardgame/search?q='+encodeURIComponent(name));
  if (!html) return null;
  const want = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const re = /\/boardgame\/price\/([A-Za-z0-9_-]{6,})\/([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(html))){ if (m[2]===want) return m[1]; }
  return null;
}

// ---- India (Board Games India + others) ----
function meta(html, prop){
  if (!html) return null;
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']'+prop+'["\'][^>]+content=["\']([^"\']+)["\']','i');
  const m = html.match(re); return m ? m[1] : null;
}
function firstNum(s){ if(!s) return null; const m=String(s).replace(/,/g,'').match(/([0-9]+(?:\.[0-9]+)?)/); return m?parseFloat(m[1]):null; }
async function scrapeIndia(url){
  const html = await get(url);
  if (!html) return null;
  let price = firstNum(meta(html,'product:sale_price:amount') || meta(html,'product:price:amount') || meta(html,'og:price:amount'));
  // JSON-LD offers price
  if (price==null){ const j = html.match(/"price"\s*:\s*"?([0-9][0-9.,]*)"?/); if (j) price = firstNum(j[1]); }
  // og:title often contains ", Rs. 5,500.00,"
  if (price==null){ const t = meta(html,'og:title') || ''; const r = t.match(/₹\s*([0-9][0-9,]*(?:\.[0-9]+)?)/); if (r) price = firstNum(r[1]); }
  if (price==null || !isFinite(price) || price<=0) return null;
  const avail = (meta(html,'og:availability') || meta(html,'product:availability') || '').toLowerCase();
  const stock = /instock|in stock/.test(avail) ? 'In stock' : (avail || '');
  return { price: price, source:'Board Games India', stock: stock };
}

// ---- FX to INR ----
async function fetchFX(existing){
  const html = await get('https://api.frankfurter.app/latest?from=INR&to=USD,GBP,CAD,AUD,NZD');
  try{
    const j = JSON.parse(html); const r = j.rates; const inv = x => Math.round((1/x)*100)/100;
    const fx = { USD:inv(r.USD), GBP:inv(r.GBP), CAD:inv(r.CAD), AUD:inv(r.AUD), NZD:inv(r.NZD) };
    for (const k of Object.keys(fx)) if (!isFinite(fx[k]) || fx[k]<=0) return existing;
    return fx;
  }catch(e){ return existing; }
}

(async function main(){
  const data = JSON.parse(fs.readFileSync(PATH,'utf8'));
  data.meta.fx = await fetchFX(data.meta.fx);
  data.meta.updated = new Date().toISOString().slice(0,10);

  // Apply per-game bgoId overrides set in the app (state.json in the repo, if present)
  let ovMap = {};
  try { const st = JSON.parse(fs.readFileSync('./state.json','utf8')); ovMap = (st && st.overrides) || {}; console.log('Loaded state.json overrides.'); } catch(e){}

  let processed=0, intlPriced=0, indiaPriced=0, idsResolved=0, stillNoId=0;
  for (const g of data.games){
    if (g.status==='Purchased' || g.status==='Dropped') continue;
    const ovr = ovMap[g.name]; if (ovr && ovr.bgoId) g.bgoId = ovr.bgoId;   // app-supplied ID wins
    // Auto-resolve is OFF by default (slow + risky). Set RESOLVE_IDS=1 to enable.
    if (!g.bgoId && process.env.RESOLVE_IDS==='1'){ const id = await resolveBgoId(g.name); if (id){ g.bgoId=id; idsResolved++; await sleep(700); } }
    if (g.bgoId){
      const slug = (g.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      const r = await scrapeBGO(g.bgoId, slug);
      const prevP = g.prices || {}, prevS = g.stock || {};
      const np = {}, ns = {};
      for (const c of Object.keys(LOCALE)){
        if (r.prices[c] != null){ np[c] = r.prices[c]; ns[c] = r.stock[c] || 'In stock'; }
        else if (prevP[c] != null){ np[c] = prevP[c]; ns[c] = 'Out of stock'; }   // keep last-known price, flag OOS
        else { np[c] = null; ns[c] = r.stock[c] || ''; }
      }
      g.prices = np; g.stock = ns;
      if (Object.values(np).some(function(v){return v!=null;})) intlPriced++;
    } else { stillNoId++; }
    if (g.indiaUrl){
      const ind = await scrapeIndia(g.indiaUrl);
      if (ind){ g.india = ind; indiaPriced++; }
      else if (g.india && g.india.price){ g.india.stock = 'Out of stock'; }        // keep last-known India price, flag OOS
    }
    processed++;
    if (processed % 10 === 0) console.log('  ...'+processed+'/'+data.games.length);
  }
  fs.writeFileSync(PATH, JSON.stringify(data, null, 1));
  console.log('Done. Processed '+processed+' games.');
  console.log('  International prices found : '+intlPriced);
  console.log('  India prices found        : '+indiaPriced);
  console.log('  BGO IDs auto-resolved      : '+idsResolved+' (strict slug match)');
  console.log('  Still missing a BGO ID     : '+stillNoId);
  if (intlPriced===0) console.log('  NOTE: 0 international - dumping one raw price page would let the parser be fixed exactly.');
})();
