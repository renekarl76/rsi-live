// ========= RSI (Wilder)
export function rsiSeries(closes, period=14){
  const out=new Array(closes.length).fill(null);
  if(closes.length<period+1) return out;
  let g=0,l=0;
  for(let i=1;i<=period;i++){ const d=closes[i]-closes[i-1]; g+=Math.max(d,0); l+=Math.max(-d,0); }
  let ag=g/period, al=l/period;
  out[period]=100-100/(1+(al===0?1000:ag/al));
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1], gg=Math.max(d,0), ll=Math.max(-d,0);
    ag=(ag*(period-1)+gg)/period; al=(al*(period-1)+ll)/period;
    const rs=(al===0)?1000:(ag/al); out[i]=100-100/(1+rs);
  }
  return out;
}

// ========= Signaux RSI (croisements)
export function signalsRSI(rsi, low, high, buyMode='up', sellMode='down'){
  const sig=new Array(rsi.length).fill(null);
  for(let i=1;i<rsi.length;i++){
    const p=rsi[i-1],c=rsi[i]; if(p==null||c==null) continue;
    if(buyMode==='up'){ if(p<low && c>=low) sig[i]='BUY'; } else { if(p>low && c<=low) sig[i]='BUY'; }
    if(sellMode==='down'){ if(p>high && c<=high) sig[i]='SELL'; } else { if(p<high && c>=high) sig[i]='SELL'; }
  }
  return sig;
}

// ========= helpers
function maxDrawdown(series){
  let peak=-Infinity, dd=0;
  for(const v of series){ if(!Number.isFinite(v)) continue; if(v>peak) peak=v; dd=Math.min(dd,(v-peak)/peak); }
  return dd||0;
}
function avg(arr){ const v=arr.filter(Number.isFinite); return v.length? v.reduce((a,b)=>a+b,0)/v.length : 0; }

// ========= Backtest #1 (simple all-in/out)
export function backtest(closes, sig, feesBps=0){
  const fee=feesBps/10000; let pos=0, entry=0, cash=1;
  const equity=new Array(closes.length).fill(null);
  const invested=new Array(closes.length).fill(0);
  const contribSeries=new Array(closes.length).fill(0);
  let contribTotal=0;
  const trades=[];
  for(let i=0;i<closes.length;i++){
    const s=sig[i];
    if(s==='BUY' && pos===0){
      pos=1; entry=closes[i];
      if(contribTotal===0){ contribTotal+=1; } // 1U initial
      trades.push({type:'BUY',i,price:closes[i],units:1});
    } else if(s==='SELL' && pos===1){
      const ret=closes[i]/entry-1; const after=(1+ret)*(1-fee); cash*=after;
      trades.push({type:'SELL',i,price:closes[i],ret:after-1,units:1}); pos=0; entry=0;
    }
    invested[i]=pos; equity[i]= pos? cash*(closes[i]/entry) : cash;
    contribSeries[i]=contribTotal;
  }
  const totalReturn=(equity.at(-1)??1)-1, dd=maxDrawdown(equity);
  const netReturn = contribTotal>0 ? ( (equity.at(-1)??1) / contribTotal - 1 ) : 0;
  const closed = trades.filter(t=>t.type==='SELL').map(t=>t.ret??0);
  const winRate = closed.length? closed.filter(r=>r>0).length/closed.length : 0;
  return {
    equity, investedSeries: invested, totalReturn, netReturn, contribSeries, contribTotal,
    maxDD:dd, trades, winRate,
    maxInvested:Math.max(...invested,0), avgInvested:avg(invested.filter(v=>v>0)), lastStake:1
  };
}

// ========= Backtest #2a (pyramiding NO-LOSS, vente TOTALE uniquement)
function backtestExtendedTotal(closes, sig, feesBps=0){
  const fee=feesBps/10000;
  let bank=0, lots=[], stake=1;
  const equity=new Array(closes.length).fill(null);
  const invested=new Array(closes.length).fill(0);
  const contribSeries=new Array(closes.length).fill(0);
  let contribTotal=0;
  const trades=[];
  const posUnits=()=>lots.reduce((s,l)=>s+l.units,0);
  const mtm=(px)=> bank + lots.reduce((s,l)=> s + l.units*(px/l.entry), 0);
  const pnlTot=(px)=> lots.reduce((s,l)=> s + l.units*(px/l.entry - 1), 0);

  for(let i=0;i<closes.length;i++){
    const px=closes[i], s=sig[i];
    if(s==='BUY'){
      if(lots.length===0){
        if(contribTotal===0) contribTotal += 1; // 1U initial au tout début
        lots.push({units:stake, entry:px}); trades.push({type:'BUY',i,price:px,units:stake});
      } else {
        lots.push({units:1, entry:px}); trades.push({type:'BUY+',i,price:px,units:1});
        contribTotal += 1; // +1U externe
      }
    } else if(s==='SELL' && lots.length>0){
      if(pnlTot(px) >= 0){
        let realized=0; for(const l of lots){ realized += l.units*(px/l.entry); }
        realized *= (1 - fee); bank += realized;
        trades.push({type:'SELL',i,price:px,units:posUnits(), realized});
        stake = realized; lots = [];
      }
    }
    invested[i]=posUnits(); equity[i]=mtm(px);
    contribSeries[i]=contribTotal;
  }
  const totalReturn=(equity.at(-1)??1)-1, dd=maxDrawdown(equity);
  const netReturn = contribTotal>0 ? ( (equity.at(-1)??1) / contribTotal - 1 ) : 0;
  return {
    equity, investedSeries: invested, totalReturn, netReturn, contribSeries, contribTotal,
    maxDD:dd, trades, winRate:1,
    maxInvested:Math.max(...invested,0), avgInvested:avg(invested.filter(v=>v>0)), lastStake:stake
  };
}

// ========= Backtest #2b (pyramiding NO-LOSS + ventes partielles)
function backtestExtendedPartial(closes, sig, feesBps=0){
  const fee=feesBps/10000;
  let bank=0, lots=[], stake=1;
  const equity=new Array(closes.length).fill(null);
  const invested=new Array(closes.length).fill(0);
  const contribSeries=new Array(closes.length).fill(0);
  let contribTotal=0;
  const trades=[];
  const posUnits=()=>lots.reduce((s,l)=>s+l.units,0);
  const mtm=(px)=> bank + lots.reduce((s,l)=> s + l.units*(px/l.entry), 0);
  const pnlTot=(px)=> lots.reduce((s,l)=> s + l.units*(px/l.entry - 1), 0);

  for(let i=0;i<closes.length;i++){
    const px=closes[i], s=sig[i];
    if(s==='BUY'){
      if(lots.length===0){
        if(contribTotal===0) contribTotal += 1; // 1U initial
        lots.push({units:stake, entry:px}); trades.push({type:'BUY',i,price:px,units:stake});
      } else {
        lots.push({units:1, entry:px}); trades.push({type:'BUY+',i,price:px,units:1});
        contribTotal += 1; // +1U externe
      }
    } else if(s==='SELL' && lots.length>0){
      if(pnlTot(px) >= 0){
        let realized=0; for(const l of lots){ realized += l.units*(px/l.entry); }
        realized *= (1 - fee); bank += realized;
        trades.push({type:'SELL',i,price:px,units:posUnits(), realized});
        stake = realized; lots = [];
      } else {
        const keep=[]; let realized=0;
        for(const l of lots){
          if(px > l.entry){
            const val = l.units*(px/l.entry) * (1 - fee);
            realized += val;
            trades.push({type:'SELL_PART',i,price:px,units:l.units, realized:val});
          } else keep.push(l);
        }
        lots = keep; bank += realized;
      }
    }
    invested[i]=posUnits(); equity[i]=mtm(px);
    contribSeries[i]=contribTotal;
  }
  const totalReturn=(equity.at(-1)??1)-1, dd=maxDrawdown(equity);
  const netReturn = contribTotal>0 ? ( (equity.at(-1)??1) / contribTotal - 1 ) : 0;
  return {
    equity, investedSeries: invested, totalReturn, netReturn, contribSeries, contribTotal,
    maxDD:dd, trades, winRate:1,
    maxInvested:Math.max(...invested,0), avgInvested:avg(invested.filter(v=>v>0)), lastStake:stake
  };
}

// ========= Optimisation (maximise totalReturn)
export function optimizeRSI(closes, baseRSI, opts){
  const {lowMin,lowMax,highMin,highMax,step=1,feesBps=0,buyMode='up',sellMode='down',period=14, strategy='simple'} = opts;
  const rsi = baseRSI ?? rsiSeries(closes, period);

  let best=null, tested=0;
  for(let low=lowMin; low<=lowMax; low+=step){
    for(let high=highMin; high<=highMax; high+=step){
      if(high-low<5) continue;
      const sig=signalsRSI(rsi,low,high,buyMode,sellMode);
      const bt = strategy==='simple'
        ? backtest(closes,sig,feesBps)
        : (strategy==='extended_total'
            ? backtestExtendedTotal(closes,sig,feesBps)
            : backtestExtendedPartial(closes,sig,feesBps));
      tested++;
      if(!best || bt.totalReturn>best.bt.totalReturn){ best={ low, high, bt, sig }; }
    }
  }
  return { best, tested, rsi, periodUsed: period };
}