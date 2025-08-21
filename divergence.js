// divergence.js — Détection visuelle de divergences Prix/RSI
// Exporte: detectDivergences(closes, rsi, {win=2, confirm=false})
function isLocalTop(arr, i, win, confirm) {
  const v = arr[i];
  for (let k=1;k<=win;k++) {
    if (arr[i-k] == null || arr[i+k] == null) return false;
    if (!(v > arr[i-k] && v > arr[i+k])) return false;
  }
  if (confirm && !(arr[i] > arr[i+1] && arr[i] > arr[i-1])) return false;
  return true;
}
function isLocalBottom(arr, i, win, confirm) {
  const v = arr[i];
  for (let k=1;k<=win;k++) {
    if (arr[i-k] == null || arr[i+k] == null) return false;
    if (!(v < arr[i-k] && v < arr[i+k])) return false;
  }
  if (confirm && !(arr[i] < arr[i+1] && arr[i] < arr[i-1])) return false;
  return true;
}

export function detectDivergences(closes, rsi, opts={}){
  const win = Math.max(1, opts.win ?? 2);
  const confirm = !!opts.confirm;

  const tops = [], bottoms = [];
  for (let i=win; i<closes.length-win; i++) {
    if (isLocalTop(closes, i, win, confirm)) tops.push(i);
    if (isLocalBottom(closes, i, win, confirm)) bottoms.push(i);
  }

  const bears = [];
  for (let k=1; k<tops.length; k++) {
    const i1 = tops[k-1], i2 = tops[k];
    if (closes[i2] > closes[i1] && rsi[i2] < rsi[i1]) bears.push(i2);
  }

  const bulls = [];
  for (let k=1; k<bottoms.length; k++) {
    const i1 = bottoms[k-1], i2 = bottoms[k];
    if (closes[i2] < closes[i1] && rsi[i2] > rsi[i1]) bulls.push(i2);
  }

  return { bears, bulls, tops, bottoms };
}