# CC Financial Markets MCP

> Serveur MCP (Model Context Protocol) pour les données des marchés boursiers africains — cours en temps réel, historiques, rapports annuels et actualités financières depuis [african-markets.com](https://www.african-markets.com).

---

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Outils disponibles](#outils-disponibles)
- [Places de marché supportées](#places-de-marché-supportées)
- [Installation](#installation)
- [Configuration](#configuration)
- [Modes de transport](#modes-de-transport)
  - [stdio — Claude Code / Claude Desktop](#stdio--claude-code--claude-desktop)
  - [HTTP — intégration externe](#http--intégration-externe)
  - [Vercel — déploiement serverless](#vercel--déploiement-serverless)
  - [Docker](#docker)
- [Référence des outils](#référence-des-outils)
- [Architecture](#architecture)
- [Tests](#tests)
- [Développement](#développement)

---

## Vue d'ensemble

`cc-financial-markets-mcp` expose les données de 18 bourses africaines via le protocole MCP. Il s'intègre directement à Claude Code, Claude Desktop ou toute application compatible MCP.

**Fonctionnalités principales :**

- **Cours en temps réel** — actions cotées, top hausses/baisses/volumes, indices
- **Historique** — indice (close + volume depuis 2015) et actions OHLCV (premium)
- **Documents** — rapports annuels, états financiers, communiqués (avec pagination)
- **Actualités** — derniers articles financiers africains
- **Profils d'entreprises** — fiche complète avec dividendes (premium)
- **Cache proactif** — warmer de cache adaptatif selon les horaires de trading
- **Rate limiter** — token bucket partagé entre tous les outils
- **Double transport** — stdio pour les clients MCP natifs, HTTP/SSE pour les apps externes

---

## Outils disponibles

| Outil | Description | Premium |
|-------|-------------|---------|
| `list_exchanges` | Liste les 18 places de marché avec codes, pays et devises | Non |
| `get_market_data` | Cours des actions, movers et indices en temps réel | Non |
| `get_index_history` | Historique close + volume d'un indice (depuis 2015) | Non |
| `get_annual_reports` | Rapports annuels et publications avec pagination | Non |
| `get_market_news` | Actualités financières africaines | Non |
| `get_company_profile` | Fiche complète entreprise + dividendes | Oui |
| `get_company_documents` | Historique complet des documents d'une entreprise | Oui |
| `get_stock_history` | Historique OHLCV d'une action individuelle | Oui |

Les outils **premium** nécessitent un compte sur african-markets.com (`AFRICAN_MARKETS_USERNAME` / `AFRICAN_MARKETS_PASSWORD`).

---

## Places de marché supportées

| Code | Bourse | Pays | Devise |
|------|--------|------|--------|
| JSE | Johannesburg Stock Exchange | Afrique du Sud | ZAR |
| BSE | Botswana Stock Exchange | Botswana | BWP |
| BRVM | Bourse Régionale des Valeurs Mobilières | Côte d'Ivoire (UEMOA) | XOF |
| EGX | Egyptian Exchange | Égypte | EGP |
| GSE | Ghana Stock Exchange | Ghana | GHS |
| NSE | Nairobi Securities Exchange | Kenya | KES |
| MSE | Malawi Stock Exchange | Malawi | MWK |
| BVC | Bourse de Casablanca | Maroc | MAD |
| SEM | Stock Exchange of Mauritius | Maurice | MUR |
| NSX | Namibian Stock Exchange | Namibie | NAD |
| NGX | Nigerian Exchange | Nigeria | NGN |
| USE | Uganda Securities Exchange | Ouganda | UGX |
| RSE | Rwanda Stock Exchange | Rwanda | RWF |
| DSE | Dar es Salaam Stock Exchange | Tanzanie | TZS |
| BVMT | Bourse de Tunis | Tunisie | TND |
| LUSE | Lusaka Stock Exchange | Zambie | ZMW |
| ESE | Bourse d'Eswatini | Eswatini | SZL |
| ZSE | Zimbabwe Stock Exchange | Zimbabwe | ZWL |

---

## Installation

**Prérequis :** Node.js ≥ 20

```bash
git clone https://github.com/votre-org/cc-financial-markets-mcp.git
cd cc-financial-markets-mcp
npm install
npm run build
```

---

## Configuration

Créez un fichier `.env` à la racine (voir `.env.example`) :

```env
# URL de base du site (optionnel, valeur par défaut ci-dessous)
AFRICAN_MARKETS_BASE_URL=https://www.african-markets.com/fr

# Port HTTP pour le mode serveur HTTP (défaut: 3100)
HTTP_PORT=3100

# TTL du cache en secondes (défaut: 300 = 5 min)
CACHE_TTL_SECONDS=300

# TTL du cache pour les rapports annuels (défaut: 3600 = 1h)
CACHE_TTL_REPORTS_SECONDS=3600

# TTL du cache pour les profils d'entreprises (défaut: 1800 = 30 min)
CACHE_TTL_PROFILES_SECONDS=1800

# Limite de requêtes par minute (défaut: 30)
RATE_LIMIT_REQUESTS_PER_MINUTE=30

# Niveau de log : debug | info | warn | error (défaut: info)
LOG_LEVEL=info

# Activer le cache warmer de fond (défaut: true — désactiver en serverless)
CACHE_WARMING_ENABLED=true

# Identifiants premium african-markets.com (optionnel)
AFRICAN_MARKETS_USERNAME=
AFRICAN_MARKETS_PASSWORD=
```

---

## Modes de transport

### Serveur distant (production) — HTTP

Si le serveur est déployé en production (Vercel, VPS, conteneur…), les clients MCP s'y connectent via l'URL directement — aucune installation locale requise.

**Claude Code** (via CLI) :

```bash
claude mcp add --transport http financial-markets https://cc-financial-markets-mcp.vercel.app/mcp
```

**Claude Code** (`~/.claude/settings.json`) :

```json
{
  "mcpServers": {
    "financial-markets": {
      "url": "https://cc-financial-markets-mcp.vercel.app/mcp"
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "financial-markets": {
      "url": "https://cc-financial-markets-mcp.vercel.app/mcp"
    }
  }
}
```

Vérifiez que le serveur est en ligne avant de configurer le client :

```bash
curl https://cc-financial-markets-mcp.vercel.app/health
```

---

### stdio — Claude Code / Claude Desktop (local)

Pour exécuter le serveur localement. Ajoutez le serveur dans votre configuration MCP :

**Claude Code** (`~/.claude/settings.json` ou via `claude mcp add`) :

```json
{
  "mcpServers": {
    "financial-markets": {
      "command": "node",
      "args": ["/chemin/vers/cc-financial-markets-mcp/dist/index.js"]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "financial-markets": {
      "command": "node",
      "args": ["/chemin/vers/cc-financial-markets-mcp/dist/index.js"]
    }
  }
}
```

### HTTP — intégration externe

Démarrez le serveur en mode HTTP avec le flag `--http` :

```bash
node dist/index.js --http          # Port par défaut : 3100
node dist/index.js --http 8080     # Port personnalisé
```

Le serveur expose :

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | Session MCP (initialize + tool calls) |
| `GET /mcp` | Page d'information en HTML (navigateur) |
| `GET /health` | Health check JSON avec stats du cache warmer |

**Exemple d'appel depuis une application :**

```bash
# 1. Initialiser la session
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "mon-app", "version": "1.0" }
    }
  }'

# 2. Appeler un outil (remplacer SESSION_ID par la valeur du header mcp-session-id reçu)
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: SESSION_ID" \
  -d '{
    "jsonrpc": "2.0", "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_market_data",
      "arguments": { "exchange": "BRVM", "type": "movers" }
    }
  }'
```

**Test rapide en JSON-RPC via stdio :**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_market_data","arguments":{"exchange":"BRVM","type":"movers"}}}' \
  | node dist/index.js
```

### Vercel — déploiement serverless

Le fichier `src/index.ts` exporte un handler `default` compatible Vercel. Déployez directement :

```bash
vercel deploy
```

> **Note :** désactivez le cache warmer en serverless (`CACHE_WARMING_ENABLED=false`) car les instances éphémères ne maintiennent pas d'état de fond.

### Docker

```bash
# Build
docker build -t cc-financial-markets-mcp .

# Mode stdio (pipe JSON-RPC)
docker run --rm -i cc-financial-markets-mcp

# Mode HTTP
docker run --rm -p 3100:3100 \
  -e CACHE_WARMING_ENABLED=false \
  cc-financial-markets-mcp --http 3100
```

---

## Référence des outils

### `list_exchanges`

Liste toutes les places de marché supportées, avec filtrage optionnel par pays.

```json
{
  "country": "Kenya"
}
```

Retourne : code, nom, pays, devise pour chaque bourse.

---

### `get_market_data`

Récupère les données de marché en temps réel pour une bourse donnée.

```json
{
  "exchange": "BRVM",
  "type": "all",
  "force_refresh": false
}
```

| Paramètre | Type | Valeurs | Défaut |
|-----------|------|---------|--------|
| `exchange` | string | Code bourse (ex: `BRVM`, `JSE`) | requis |
| `type` | enum | `stocks` \| `movers` \| `indices` \| `all` | `all` |
| `force_refresh` | boolean | Ignorer le cache | `false` |

Retourne selon le type :
- **stocks** — liste complète des actions cotées (symbole, prix, variation, capitalisation)
- **movers** — top 5 hausses, baisses et volumes du jour
- **indices** — valeur et variation de tous les indices africains
- **all** — les trois combinés

---

### `get_index_history`

Historique de l'indice principal d'une bourse (close + volume, disponible depuis 2015 sans abonnement).

```json
{
  "exchange": "JSE",
  "period": "1y",
  "force_refresh": false
}
```

| Paramètre | Valeurs disponibles |
|-----------|-------------------|
| `period` | `1m` `3m` `6m` `1y` `3y` `5y` `all` |

Retourne : tableau de points `{ date, close, volume }`.

---

### `get_annual_reports`

Récupère les rapports et publications d'une bourse, avec pagination et filtres multiples.

```json
{
  "exchange": "BRVM",
  "year": 2024,
  "company": "Sonatel",
  "document_type": "rapport",
  "page": 1,
  "pages": 2
}
```

| Paramètre | Description |
|-----------|-------------|
| `year` | Filtre par année (optionnel) |
| `company` | Recherche partielle par nom ou symbole |
| `document_type` | Filtre partiel sur le type de document |
| `page` | Page de départ (1-indexed) |
| `pages` | Nombre de pages à récupérer consécutivement (max 5) |

Retourne : métadonnées de pagination + liste de rapports avec URL de téléchargement.

---

### `get_market_news`

Dernières actualités financières africaines depuis la page d'accueil d'african-markets.com.

```json
{
  "exchange": "NGX",
  "limit": 10
}
```

Retourne : titre, résumé, URL, date, source et tag bourse de chaque article.

---

### `get_company_profile` *(premium)*

Fiche complète d'une entreprise cotée : informations générales, documents, dividendes.

```json
{
  "exchange": "BRVM",
  "symbol": "SNTS"
}
```

Retourne : infos société (ISIN, date de création, cotation), prix courant, rapports annuels, communiqués, analyses, dividendes historiques.

---

### `get_company_documents` *(premium)*

Historique complet des documents publiés par une entreprise (rapports annuels, états financiers, communiqués).

```json
{
  "exchange": "BRVM",
  "symbol": "ETIT"
}
```

---

### `get_stock_history` *(premium)*

Historique OHLCV quotidien d'une action individuelle.

```json
{
  "exchange": "JSE",
  "symbol": "NPN",
  "period": "1y",
  "force_refresh": false
}
```

| Paramètre | Valeurs disponibles |
|-----------|-------------------|
| `period` | `1m` `3m` `6m` `1y` `3y` `5y` `all` |

Retourne : tableau de points `{ date, open, high, low, close, volume }`.

---

## Architecture

```
src/
├── index.ts                    # Point d'entrée — crée le McpServer, enregistre les outils,
│                               # gère stdio et HTTP (sessions SSE, CORS, /health)
├── config.ts                   # Configuration via variables d'environnement
├── logger.ts                   # Logger JSON structuré → stderr (stdout réservé MCP)
├── types/
│   └── markets.ts              # Types domaine + constante AFRICAN_EXCHANGES (18 bourses)
├── cache/
│   ├── cache.ts                # Cache TTL en mémoire (Map, sans dépendance externe)
│   └── warmer.ts               # Cache warmer adaptatif (5 min en trading, 60 min hors séance)
├── scraper/
│   ├── rate-limiter.ts         # Token bucket partagé (requêtes/minute)
│   ├── fetcher.ts              # Fetch HTTP avec User-Agent navigateur, retry, cache
│   ├── auth.ts                 # Authentification premium (cookie de session)
│   ├── parser.ts               # Parseurs Cheerio pour les tables DOM d'african-markets.com
│   ├── index-history-parser.ts # Extraction du chartData JS inline (historique indices)
│   └── stock-history-parser.ts # Extraction OHLCV depuis les pages profil (premium)
└── tools/
    ├── list-exchanges.ts        # Fonction pure, pas de scraping
    ├── market-data.ts           # Stocks, movers, indices
    ├── annual-reports.ts        # Publications edocman avec pagination
    ├── market-news.ts           # Actualités homepage (Raxo)
    ├── company-profile.ts       # Profil complet entreprise
    ├── company-documents.ts     # Documents complets entreprise
    ├── index-history.ts         # Historique indice avec filtrage par période
    └── stock-history.ts         # Historique OHLCV avec filtrage par période
```

### Flux de données

```
Client MCP
    │
    ▼
index.ts (dispatch)
    │
    ▼
tools/*.ts (handler + validation Zod)
    │
    ▼
Fetcher (cache → rate limiter → HTTP)
    │
    ▼
parser.ts / *-parser.ts (Cheerio → types domaine)
    │
    ▼
JSON sérialisé → réponse MCP
```

### Décisions de conception

- **Stdout réservé** — tout le logging passe par stderr. Stdout est exclusivement pour le JSON-RPC MCP.
- **User-Agent navigateur** — le site est derrière Cloudflare ; une requête sans UA standard reçoit une 403.
- **Pas de base de données** — les données sont éphémères, récupérées à la demande avec un cache TTL en mémoire.
- **Rate limiter partagé** — une seule instance `RateLimiter` entre tous les outils pour respecter les limites du site.
- **Cache warmer adaptatif** — pendant les heures de trading (n'importe quelle bourse ouverte) : refresh toutes les 5 min ; en dehors : toutes les 60 min. Les bourses ouvertes sont traitées en priorité.
- **Format français** — le site est scrapé via `/fr`. Le parsing des nombres gère le format français (ex: `1 234,56`).

---

## Tests

```bash
# Tests unitaires
npm test

# Mode watch
npm run test:watch

# Couverture de code
npm run test:coverage

# Un test spécifique
npm run test:single -- "parseNumber"

# Tests d'intégration (accès réseau réel)
npm run test:integration

# Tous les tests
npm run test:all
```

Les tests couvrent les parseurs, le cache, le rate limiter, l'authentification et chaque outil MCP.

---

## Développement

```bash
# Démarrer en mode watch (rechargement auto)
npm run dev

# Vérification des types
npm run typecheck

# Lint
npm run lint
npm run lint:fix

# Compiler
npm run build

# Inspecter les outils via l'UI MCP Inspector
npm run inspect
```

### Ajouter une nouvelle bourse

Ajoutez une entrée dans le tableau `AFRICAN_EXCHANGES` de [src/types/markets.ts](src/types/markets.ts) :

```typescript
{ name: "Nom de la bourse", code: "CODE", country: "Pays", currency: "DEV", url: "slug-du-site" }
```

Le `url` correspond au slug utilisé dans `/fr/bourse/{slug}` sur african-markets.com.

### Ajouter un nouvel outil

1. Créez `src/tools/mon-outil.ts` avec un schéma Zod et une fonction handler async
2. Enregistrez-le dans `src/index.ts` via `server.tool(name, description, schema.shape, handler)`
3. Ajoutez les tests dans `src/tools/mon-outil.test.ts`

### Structure DOM d'african-markets.com (Joomla CMS)

Sélecteurs CSS clés utilisés par les parseurs :

| Sélecteur | Usage |
|-----------|-------|
| `table[class^='tabtable-']` | Toutes les tables de données |
| `table[class*='tabtable-rs_y3dom0sl']` | Top gainers / losers / most active (3 tables, 5 lignes) |
| `table[class*='tabtable-rs_m316x72x']` | Indices globaux (17 lignes) |
| `table.edocman_document_list` | Table des publications |
| `.edocman_document_link` | Lien titre dans les publications |
| `article.raxo-item-top`, `article.raxo-item-nor` | Articles actualités homepage |

> **Note :** les parseurs sont fragiles par nature — le DOM du site peut changer. Si le scraping casse, inspectez le DOM en direct et mettez à jour les sélecteurs dans [src/scraper/parser.ts](src/scraper/parser.ts).

---

## Licence

MIT
