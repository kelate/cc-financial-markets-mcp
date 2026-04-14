/**
 * Core domain types for African stock markets data.
 */

export type MarketProvider = "african-markets" | "sgbv" | "bvmac";

export interface MarketExchange {
  name: string;
  code: string;
  country: string;
  currency: string;
  url: string;
  provider: MarketProvider;
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
  documentType?: string;
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
  { name: "Johannesburg Stock Exchange", code: "JSE", country: "Afrique du Sud", currency: "ZAR", url: "jse", provider: "african-markets" },
  { name: "Botswana Stock Exchange", code: "BSE", country: "Botswana", currency: "BWP", url: "bse", provider: "african-markets" },
  { name: "BRVM", code: "BRVM", country: "Côte d'Ivoire (UEMOA)", currency: "XOF", url: "brvm", provider: "african-markets" },
  { name: "Egyptian Exchange", code: "EGX", country: "Égypte", currency: "EGP", url: "egx", provider: "african-markets" },
  { name: "Ghana Stock Exchange", code: "GSE", country: "Ghana", currency: "GHS", url: "gse", provider: "african-markets" },
  { name: "Nairobi Securities Exchange", code: "NSE", country: "Kenya", currency: "KES", url: "nse", provider: "african-markets" },
  { name: "Malawi Stock Exchange", code: "MSE", country: "Malawi", currency: "MWK", url: "mse", provider: "african-markets" },
  { name: "Bourse de Casablanca", code: "BVC", country: "Maroc", currency: "MAD", url: "bvc", provider: "african-markets" },
  { name: "Stock Exchange of Mauritius", code: "SEM", country: "Maurice", currency: "MUR", url: "sem", provider: "african-markets" },
  { name: "Namibian Stock Exchange", code: "NSX", country: "Namibie", currency: "NAD", url: "nsx", provider: "african-markets" },
  { name: "Nigerian Exchange", code: "NGX", country: "Nigeria", currency: "NGN", url: "ngse", provider: "african-markets" },
  { name: "Uganda Securities Exchange", code: "USE", country: "Ouganda", currency: "UGX", url: "use", provider: "african-markets" },
  { name: "Rwanda Stock Exchange", code: "RSE", country: "Rwanda", currency: "RWF", url: "rse", provider: "african-markets" },
  { name: "Dar es Salaam Stock Exchange", code: "DSE", country: "Tanzanie", currency: "TZS", url: "dse", provider: "african-markets" },
  { name: "Bourse de Tunis", code: "BVMT", country: "Tunisie", currency: "TND", url: "bvmt", provider: "african-markets" },
  { name: "Lusaka Stock Exchange", code: "LUSE", country: "Zambie", currency: "ZMW", url: "luse", provider: "african-markets" },
  { name: "Bourse d'Eswatini", code: "ESE", country: "Eswatini", currency: "SZL", url: "ese", provider: "african-markets" },
  { name: "Zimbabwe Stock Exchange", code: "ZSE", country: "Zimbabwe", currency: "ZWL", url: "zse", provider: "african-markets" },
  { name: "Bourse d'Alger", code: "SGBV", country: "Algérie", currency: "DZD", url: "", provider: "sgbv" },
  { name: "Bourse des Valeurs Mobilières de l'Afrique Centrale", code: "BVMAC", country: "CEMAC", currency: "XAF", url: "", provider: "bvmac" },
];