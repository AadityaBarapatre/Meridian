export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  spark: number[];
}

export interface Tick {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  candle: Candle;
}

export interface Position {
  symbol: string;
  qty: number;
  available: number;
  avg: number;
  last: number;
  marketValue: number;
  costBasis: number;
  unrealized: number;
  unrealizedPct: number;
  realized: number;
  allocation: number;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: 'B' | 'S';
  type: 'LIMIT' | 'MARKET';
  price: number;
  qty: number;
  remaining: number;
  ts: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface Portfolio {
  cash: number;
  equity: number;
  buyingPower: number;
  startEquity: number;
  totalPnl: number;
  totalPnlPct: number;
  realized: number;
  positions: Position[];
  orders: OpenOrder[];
  history: EquityPoint[];
}

export interface BookLevel {
  price: number;
  qty: number;
  cum: number;
}

export interface Book {
  symbol: string;
  last: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface Trade {
  id: number;
  symbol: string;
  price: number;
  qty: number;
  side: 'B' | 'S';
  ts: number;
}

export type Timeframe = 1 | 5 | 15 | 60;
