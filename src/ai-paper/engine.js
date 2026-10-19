const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
export function estimatePnL(p) {
  return ((p.currentPrice ?? p.entry) - p.entry) * p.quantity;
}
export function riskCommitted(open) {
  return open.reduce((sum,p)=>sum + Math.max(0,p.entry-p.initialPremiumStop)*p.quantity,0);
}
export function createPaperPosition({snapshot,assessment,capital=50000,riskPct=1,open=[]}) {
  if (!snapshot?.live || snapshot?.market?.phase!=='LIVE') return {error:'A live FYERS snapshot is required.'};
  if (assessment?.action!=='ENTER') return {error:'Claude did not recommend an entry.'};
  const option=snapshot.option||{}, market=snapshot.market||{};
  const side=assessment.side, price=num(option.ltp),spot=num(market.spot),size=num(option.lotSize);
  const stop=num(assessment.optionPremiumStop),underlyingStop=num(assessment.underlyingStop);
  if (!['CE','PE'].includes(side) || option.optionType!==side || !option.symbol || !price || !spot || !size)
    return {error:'No verified live option contract matches the Claude direction.'};
  if (!stop || stop>=price || stop<=0 || !underlyingStop ||
      (side==='CE' && underlyingStop>=spot) || (side==='PE' && underlyingStop<=spot))
    return {error:'Claude did not supply consistent risk-defining stops.'};
  const perLotRisk=(price-stop)*size;
  const budget=Math.max(0,capital)*Math.max(0,riskPct)/100;
  if (perLotRisk>budget) return {error:'One option lot exceeds the virtual risk budget.'};
  if (riskCommitted(open)+perLotRisk>budget*5)
    return {error:'Combined virtual portfolio risk cap reached.'};
  const key=[market.sessionDate||'session',side,option.symbol,Math.floor(Date.now()/180000)].join(':');
  if (open.some(p=>p.entryKey===key)) return {error:'Duplicate Claude decision on the same contract and three-minute setup.'};
  const at=new Date().toISOString();
  return {position:{
    id:crypto.randomUUID(),strategy:'CLAUDE_AI',source:'CLAUDE',entryKey:key,
    symbol:option.symbol,side,quantity:size,entry:price,currentPrice:price,
    initialPremiumStop:stop,optionStop:stop,underlyingStop,
    underlyingEntry:spot,currentSpot:spot,
    openedAt:at,lastSeenAt:at,highWater:price, status:'OPEN',
    entryReason:String(assessment.reason||'').slice(0,700),
    regime:String(assessment.regime||'').slice(0,100),
    model:assessment.model||'Claude',paper:true
  }};
}
export function applyAssessment(positions,assessment) {
  const changes=[];let next=positions.map(p=>{
    const a=(assessment?.positionActions||[]).find(z=>z.id===p.id);
    if (!a) return p;
    if (a.action==='EXIT') {
      return {...p,exitRequested:true,exitReason:a.reason||'Claude exit decision'};
    }
    if (a.action==='TRAIL') {
      const candidate=num(a.optionPremiumStop);
      if (candidate && candidate>p.optionStop && candidate<(p.currentPrice||p.entry)) {
        changes.push({type:'TRAIL',id:p.id,previousStop:p.optionStop,newStop:candidate,reason:a.reason});
        return {...p,optionStop:candidate,lastTrailReason:a.reason};
      }
    }
    return p;
  });
  return {positions:next,changes};
}
export function updatePrices(positions,quotes,spot,now=new Date().toISOString()) {
  const closed=[];const remaining=[];const validSpot=num(spot);
  for (const p of positions) {
    const marketPrice=num(quotes?.[p.symbol]);
    const underlying=validSpot ?? p.currentSpot;
    if (marketPrice==null || marketPrice<=0) {remaining.push(p);continue;}
    const current={...p,currentPrice:marketPrice,currentSpot:underlying,
      highWater:Math.max(num(p.highWater)||p.entry,marketPrice),lastSeenAt:now};
    const underlyingHit=validSpot!=null&&(p.side==='CE'?validSpot<=p.underlyingStop:validSpot>=p.underlyingStop);
    const premiumHit=marketPrice<=p.optionStop;
    if (premiumHit || underlyingHit || p.exitRequested) {
      const reason=p.exitRequested?p.exitReason:underlyingHit?'NIFTY structure invalidation':'Option premium protective stop';
      closed.push({...current,status:'CLOSED',exitPrice:marketPrice,closedAt:now,
        exitReason:reason,pnl:(marketPrice-p.entry)*p.quantity,exitMethod:'SIMULATED_QUOTE'});
    } else remaining.push(current);
  }
  return {positions:remaining,closed};
}
export function tradeMetrics(history=[]) {
  const total=history.reduce((sum,p)=>sum+Number(p.pnl||0),0);
  const wins=history.filter(p=>Number(p.pnl)>0).length;
  const losses=history.filter(p=>Number(p.pnl)<0).length;
  return {count:history.length,total,wins,losses,winRate:history.length?100*wins/history.length:0};
}
