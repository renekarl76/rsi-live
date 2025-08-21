// live.js — suivi temps réel via miniTicker Binance (WebSocket) + re-calcul RSI
import { rsiSeries, signalsRSI } from './strategy.js';

function streamNameFor(symbol){ return symbol.toLowerCase() + '@miniTicker'; }
function dayStartUTC(ts){ const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

export class LiveMonitor {
  constructor({ getState, getParams, onUpdate, onStatus }) {
    this.getState = getState;
    this.getParams = getParams;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.ws = null;
    this.timer = null;
    this.lastPrice = null;
    this.throttleMs = 10000;
    this._scheduled = false;
  }
  setThrottle(ms){ this.throttleMs = Math.max(1000, ms|0); }

  start(){
    this.stop();
    const { symbol } = this.getParams();
    const stream = streamNameFor(symbol);
    const url = `wss://stream.binance.com:9443/ws/${stream}`;
    try{
      this.ws = new WebSocket(url);
    }catch(e){
      this.onStatus?.('WebSocket indisponible, polling 30s');
      this._fallbackPolling();
      return;
    }
    this.ws.onopen = ()=> this.onStatus?.('Live connecté');
    this.ws.onclose = ()=> { this.onStatus?.('Live déconnecté'); this.ws=null; };
    this.ws.onerror = ()=> this.onStatus?.('Erreur WebSocket');
    this.ws.onmessage = (ev)=>{
      try{
        const msg = JSON.parse(ev.data);
        if(!msg?.c) return;
        this.lastPrice = +msg.c;
        this._scheduleCompute();
      }catch(_){}
    };
  }

  stop(){
    if(this.ws){ try{ this.ws.close(); }catch(_){ } this.ws=null; }
    if(this.timer){ clearInterval(this.timer); this.timer=null; }
    this.lastPrice = null;
  }

  _fallbackPolling(){
    const poll = async ()=>{
      try{
        const { symbol } = this.getParams();
        const u = new URL('https://api.binance.com/api/v3/klines');
        u.searchParams.set('symbol', symbol);
        u.searchParams.set('interval', '1m');
        u.searchParams.set('limit', '1');
        const r = await fetch(u.toString());
        if(!r.ok) return;
        const arr = await r.json();
        if(arr?.length){
          this.lastPrice = +arr[0][4];
          this._scheduleCompute();
        }
      }catch(_){}
    };
    poll();
    this.timer = setInterval(poll, 30000);
  }

  _scheduleCompute(){
    if(this._scheduled) return;
    this._scheduled = true;
    setTimeout(()=>{ this._scheduled=false; this._compute(); }, this.throttleMs);
  }

  _compute(){
    if(this.lastPrice==null) return;
    const st = this.getState();
    if(!st?.times?.length || !st?.closes?.length) return;

    const times = st.times.slice();
    const closes = st.closes.slice();

    const now = Date.now();
    const lastDay = dayStartUTC(times.at(-1));
    const today = dayStartUTC(now);

    if(today > lastDay){
      times.push(now);
      closes.push(this.lastPrice);
    } else {
      closes[closes.length-1] = this.lastPrice;
    }

    const rsi = rsiSeries(closes, st.period);

    const low = st.best.low, high = st.best.high;
    const sig = signalsRSI(rsi, low, high, st.buyMode, st.sellMode);

    const i = closes.length - 1;
    const action = sig[i] || 'HOLD';
    const rsiNow = rsi[i];

    this.onUpdate?.({
      time: times[i],
      price: closes[i],
      rsi: rsiNow,
      action,
      low, high
    });
  }
}