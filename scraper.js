#!/usr/bin/env node
/*
 * Board Game Price Tracker — full-list scraper
 * Updates data.json in place: prices (5 countries) + India price, and FX rates.
 *
 * Run locally:   node scraper.js           (needs Node 18+ for global fetch)
 * Or in GitHub Actions (see .github/workflows/update-prices.yml).
 *
 * It only touches prices / stock / india / meta.fx / meta.updated.
 * It never changes the game list, your per-game discounts, or status.
 *
 * NOTE ON SELECTORS: Board Game Oracle price rows are parsed heuristically from the
 * server-rendered HTML. If a run returns 0 prices for games you know are listed, the
 * page markup changed — adjust parseBGO() (it's isolated and commented).
 */
const fs = require('fs');
const PATH = process.env.DATA_PATH || './data.json';
const LOCALE = { USA:'', UK:'/en-GB', Canada:'/en-CA', Australia:'/en-AU', NZ:'/en-NZ' };
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent':'Mozilla/5.0 (price-tracker)' };

async function get(url){
  try{ const r = await fetch(url, { headers: UA }); if(!r.ok) return null; return await r.text(); }
  catch(e){ return null; }
}

// --- Board Game Oracle: lowest in-stock price for one game in one locale ---
function parseBGO(html){
  if(!html) return { price:null, stock:null };
  // Isolate the Prices section to avoid matching prices elsewhere on the page.
  const i = html.indexOf('>Prices<'); const sec = i>=0 ? html.slice(i) : html;
  // Each offer row carries a price and an availability word. Grab (price, stock) pairs in order.
  // Prices look like $46.99 / £39.95 / etc. Availability: In stock / Out of stock / See store.
  const rowRe = /([$£€]|C\$|A\$|NZ\$)\s?([0-9][0-9,]*\.?[0-9]{0,2})[\s\S]{0,400}?(In stock|Out of stock|See store)/gi;
  let m, inStock=[], all=[];
  while((m = rowRe.exec(sec))){
    const val = parseFloat(m[2].replace(/,/g,''));
    if(!isFinite(val) || val<=0) continue;
    all.push(val);
    if(/in stock/i.test(m[3])) inStock.push(val);
  }
  if(inStock.length) return { price: Math.min(...inStock), stock:'In stock' };
  if(all.length)     return { price: Math.min(...all),     stock:'Out of stock' };
  return { price:null, stock:null };
}

async function scrapeBGO(bgoId){
  const out = { prices:{}, stock:{} };
  for(const [country, loc] of Object.entries(LOCALE)){
    const url = `https://www.boardgameoracle.com${loc}/boardgame/price/${bgoId}/x`;
    const html = await get(url);
    const { price, stock } = parseBGO(html);
    out.prices[country] = price; out.stock[country] = stock;
    await SLEEP(1200); // be polite
  }
  return out;
}

// --- India: read price + availability from a product page's meta tags ---
function meta(html, prop){
  if(!html) return null;
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re); return m ? m[1] : null;
}
async function scrapeIndia(url){
  const html = await get(url);
  if(!html) return null;
  const sale = meta(html,'product:sale_price:amount') || meta(html,'product:price:amount');
  const avail = (meta(html,'og:availability') || meta(html,'product:availability') || '').toLowerCase();
  const price = sale ? parseFloat(sale.replace(/[^0-9.]/g,'')) : null;
  if(price==null || !isFinite(price)) return null;
  return { price, source:'Board Games India', stock: avail.includes('instock')||avail.includes('in stock') ? 'In stock' : (avail||'') };
}

// --- FX to INR (free endpoint) ---
async function fetchFX(){
  const html = await get('https://api.exchangerate.host/latest?base=INR&symbols=USD,GBP,CAD,AUD,NZD');
  try{ const j = JSON.parse(html); const r=j.rates; const inv=x=>Math.round((1/x)*100)/100;
    return { USD:inv(r.USD), GBP:inv(r.GBP), CAD:inv(r.CAD), AUD:inv(r.AUD), NZD:inv(r.NZD) };
  }catch(e){ return null; }
}

(async function main(){
  const data = JSON.parse(fs.readFileSync(PATH,'utf8'));
  const fx = await fetchFX();
  if(fx){ data.meta.fx = fx; }
  data.meta.updated = new Date().toISOString().slice(0,10);

  let done=0, priced=0, noId=0, noIndia=0;
  for(const g of data.games){
    if(g.status==='Purchased' || g.status==='Dropped') continue;
    if(g.bgoId){
      const r = await scrapeBGO(g.bgoId);
      g.prices = r.prices; g.stock = r.stock;
      if(Object.values(r.prices).some(v=>v!=null)) priced++;
    } else { noId++; }
    if(g.indiaUrl){
      const ind = await scrapeIndia(g.indiaUrl);
      if(ind) g.india = ind; else noIndia++;
    } else { noIndia++; }
    done++;
    if(done%10===0) console.log(`  …${done}/${data.games.length}`);
  }
  fs.writeFileSync(PATH, JSON.stringify(data, null, 1));
  console.log(`Done. ${done} games processed, ${priced} with international prices.`);
  console.log(`Missing BGO ID: ${noId}. Missing/failed India: ${noIndia}.`);
  console.log('Fill each game\'s "bgoId" and "indiaUrl" in data.json once, and coverage improves every run.');
})();
