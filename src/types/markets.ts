/**
 * Core domain types for African stock markets data.
 */

export interface MarketExchange {
  name: string;
  code: string;
  country: string;
  currency: string;
  url: string;
}

export interface StockQuote {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
  marketCap?: number;
  date: string;
}

export interface MarketIndex {
  name: string;
  exchange: string;
  value: number;
  change: number;
  changePercent: number;
  date: string;
}

export interface AnnualReport {
  company: string;
  symbol: string;
  exchange: string;
  year: number;
  title: string;
  url: string;
  fileType?: string;
  publishDate?: string;
}

export interface MarketNews {
  title: string;
  summary: string;
  url: string;
  date: string;
  source?: string;
  exchange?: string;
}

export interface SectorData {
  name: string;
  exchange: string;
  stockCount: number;
  performance?: number;
  stocks: string[];
}

/**
 * Known African stock exchanges on african-markets.com.
 * The `url` field is the slug used in `/fr/bourse/{slug}`.
 * These codes and slugs are derived from the site's navigation menu.
 */
export const AFRICAN_EXCHANGES: MarketExchange[] = [
  { name: "Johannesburg Stock Exchange", code: "JSE", country: "Afrique du Sud", currency: "ZAR", url: "jse" },
  { name: "Botswana Stock Exchange", code: "BSE", country: "Botswana", currency: "BWP", url: "bse" },
  { name: "BRVM", code: "BRVM", country: "Côte d'Ivoire (UEMOA)", currency: "XOF", url: "brvm" },
  { name: "Egyptian Exchange", code: "EGX", country: "Égypte", currency: "EGP", url: "egx" },
  { name: "Ghana Stock Exchange", code: "GSE", country: "Ghana", currency: "GHS", url: "gse" },
  { name: "Nairobi Securities Exchange", code: "NSE", country: "Kenya", currency: "KES", url: "nse" },
  { name: "Malawi Stock Exchange", code: "MSE", country: "Malawi", currency: "MWK", url: "mse" },
  { name: "Bourse de Casablanca", code: "BVC", country: "Maroc", currency: "MAD", url: "bvc" },
  { name: "Stock Exchange of Mauritius", code: "SEM", country: "Maurice", currency: "MUR", url: "sem" },
  { name: "Namibian Stock Exchange", code: "NSX", country: "Namibie", currency: "NAD", url: "nsx" },
  { name: "Nigerian Exchange", code: "NGX", country: "Nigeria", currency: "NGN", url: "ngse" },
  { name: "Uganda Securities Exchange", code: "USE", country: "Ouganda", currency: "UGX", url: "use" },
  { name: "Rwanda Stock Exchange", code: "RSE", country: "Rwanda", currency: "RWF", url: "rse" },
  { name: "Dar es Salaam Stock Exchange", code: "DSE", country: "Tanzanie", currency: "TZS", url: "dse" },
  { name: "Bourse de Tunis", code: "BVMT", country: "Tunisie", currency: "TND", url: "bvmt" },
  { name: "Lusaka Stock Exchange", code: "LuSE", country: "Zambie", currency: "ZMW", url: "luse" },
  { name: "Zimbabwe Stock Exchange", code: "ZSE", country: "Zimbabwe", currency: "ZWL", url: "zse" },
];
