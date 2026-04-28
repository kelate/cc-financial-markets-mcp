# CC Financial Markets MCP

> Serveur MCP (Model Context Protocol) pour les données des marchés boursiers africains — cours en temps réel, historiques, rapports annuels et actualités financières depuis [african-markets.com](https://www.african-markets.com).

---

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Outils disponibles](#outils-disponibles)
- [Places de marché supportées](#places-de-marché-supportées)
- [Installation](#installation)
- [Configuration](#configuration)
- [Authentification (production)](#authentification-production)
- [Modes de transport](#modes-de-transport)
  - [Serveur distant — HTTP (production)](#serveur-distant--http-production)
  - [stdio — Claude Code / Claude Desktop (local)](#stdio--claude-code--claude-desktop-local)
  - [HTTP — intégration externe](#http--intégration-externe)
  - [Vercel — déploiement serverless](#vercel--déploiement-serverless)
  - [Docker](#docker)
- [Référence des outils](#référence-des-outils)
- [Architecture](#architecture)
- [Tests](#tests)
- [Développement](#développement)

---

## Vue d'ensemble

`cc-financial-markets-mcp` expose les données de 20 bourses africaines via le protocole MCP. Il s'intègre directement à Claude Code, Claude Desktop ou toute application compatible MCP.

**Fonctionnalités principales :**

- **Cours en temps réel** — actions cotées, top hausses/baisses/volumes, indices
- **Historique** — indice (close + volume depuis 2015) et actions OHLCV (premium)
- **Documents** — rapports annuels, états financiers, communiqués (avec pagination)
- **Actualités** — derniers articles financiers africains
- **Profils d'entreprises** — fiche complète avec dividendes (premium)
- **Cache proactif** — warmer adaptatif selon les horaires de trading + Redis L2
- **Circuit breaker** — protection automatique contre les pannes du scraper (CLOSED → OPEN → HALF_OPEN)
- **Rate limiter** — token bucket partagé entre tous les outils (outbound) + limiteur inbound par clé API
- **Authentification Bearer** — sécurisation `/mcp` par token API en production
- **Double transport** — stdio pour les clients MCP natifs, HTTP/SSE pour les apps externes

---

## Outils disponibles

| Outil | Description | Premium |
|-------|-------------|---------|
| `list_exchanges` | Liste les 20 places de marché avec codes, pays et devises | Non |
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

| Code | Bourse | Pays | Devise | Source |
|------|--------|------|--------|--------|
| JSE | Johannesburg Stock Exchange | Afrique du Sud | ZAR | african-markets.com |
| BSE | Botswana Stock Exchange | Botswana | BWP | african-markets.com |
| BRVM | Bourse Régionale des Valeurs Mobilières | Côte d'Ivoire (UEMOA) | XOF | african-markets.com |
| EGX | Egyptian Exchange | Égypte | EGP | african-markets.com |
| GSE | Ghana Stock Exchange | Ghana | GHS | african-markets.com |
| NSE | Nairobi Securities Exchange | Kenya | KES | african-markets.com |
| MSE | Malawi Stock Exchange | Malawi | MWK | african-markets.com |
| BVC | Bourse de Casablanca | Maroc | MAD | african-markets.com |
| SEM | Stock Exchange of Mauritius | Maurice | MUR | african-markets.com |
| NSX | Namibian Stock Exchange | Namibie | NAD | african-markets.com |
| NGX | Nigerian Exchange | Nigeria | NGN | african-markets.com |
| USE | Uganda Securities Exchange | Ouganda | UGX | african-markets.com |
| RSE | Rwanda Stock Exchange | Rwanda | RWF | african-markets.com |
| DSE | Dar es Salaam Stock Exchange | Tanzanie | TZS | african-markets.com |
| BVMT | Bourse de Tunis | Tunisie | TND | african-markets.com |
| LUSE | Lusaka Stock Exchange | Zambie | ZMW | african-markets.com |
| ESE | Bourse d'Eswatini | Eswatini | SZL | african-markets.com |
| ZSE | Zimbabwe Stock Exchange | Zimbabwe | ZWL | african-markets.com |
| SGBV | Bourse d'Alger | Algérie | DZD | sgbv.dz (API directe) |
| BVMAC | Bourse des Valeurs de l'Afrique Centrale | CEMAC | XAF | bosxch.bvm-ac.org (API directe) |

> **SGBV** et **BVMAC** utilisent leurs propres APIs publiques — indépendantes d'african-markets.com.

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
# --- Abonnement african-markets.com (optionnel — accès premium) ---
AFRICAN_MARKETS_USERNAME=
AFRICAN_MARKETS_PASSWORD=

# --- Serveur ---
AFRICAN_MARKETS_BASE_URL=https://www.african-markets.com/fr
HTTP_PORT=3100
LOG_LEVEL=info

# --- Cache ---
CACHE_TTL_SECONDS=300
CACHE_TTL_REPORTS_SECONDS=3600
CACHE_TTL_PROFILES_SECONDS=1800

# --- Cache Warmer (préchauffage proactif) ---
# Pendant les heures de trading : toutes les 5 min
# Hors séance : toutes les 60 min
# Désactiver en serverless (Vercel, Lambda) : CACHE_WARMING_ENABLED=false
CACHE_WARMING_ENABLED=true

# --- Redis (cache L2 — optionnel) ---
# Si défini, active le cache Redis en plus du cache mémoire.
REDIS_URL=

# --- Rate Limiting (outbound) ---
RATE_LIMIT_REQUESTS_PER_MINUTE=30

# --- Sécurité MCP ---
# Clés API pour l'authentification Bearer sur /mcp (virgule-séparées).
# Laisser vide pour désactiver (mode stdio/dev).
MCP_API_KEYS=

# Origins CORS autorisées. Laisser vide = wildcard "*".
MCP_ALLOWED_ORIGINS=

# Limite de requêtes par minute par clé API sur /mcp. 0 = désactivé.
MCP_INBOUND_RATE_LIMIT=60

# --- Admin ---
# Secret pour déclencher manuellement le préchauffage du cache.
MCP_ADMIN_SECRET=

# --- Circuit Breaker (résilience scraper) ---
CIRCUIT_BREAKER_THRESHOLD=3
CIRCUIT_BREAKER_TIMEOUT_SECONDS=30
```

---

## Authentification (production)

En production, le endpoint `/mcp` est protégé par une authentification Bearer token.

### Configurer les clés API

Définissez une ou plusieurs clés dans `MCP_API_KEYS` (virgule-séparées) :

```bash
# Vercel
vercel env add MCP_API_KEYS production
# Entrer : ma-cle-app-1,ma-cle-app-2

# Local
MCP_API_KEYS=ma-cle-secrete node dist/index.js --http
```

### Configurer les clients MCP avec auth

**Claude Code** (`~/.claude/settings.json`) :

```json
{
  "mcpServers": {
    "financial-markets": {
      "url": "https://cc-financial-markets-mcp.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer ma-cle-secrete"
      }
    }
  }
}
```

**Claude Code** (CLI) :

```bash
claude mcp add --transport http financial-markets \
  https://cc-financial-markets-mcp.vercel.app/mcp \
  --header "Authorization: Bearer ma-cle-secrete"
```

**Claude Desktop** (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "financial-markets": {
      "url": "https://cc-financial-markets-mcp.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer ma-cle-secrete"
      }
    }
  }
}
```

> Si `MCP_API_KEYS` est vide, l'authentification est désactivée — adapté au mode stdio local.

---

## Modes de transport

### Serveur distant — HTTP (production)

Si le serveur est déployé (Vercel, VPS, conteneur…), les clients s'y connectent directement :

```bash
# Vérifier que le serveur est en ligne
curl https://cc-financial-markets-mcp.vercel.app/health

# Status détaillé (circuit breaker, cache, Redis)
curl https://cc-financial-markets-mcp.vercel.app/admin/status
```

---

### stdio — Claude Code / Claude Desktop (local)

Ajoutez le serveur dans votre configuration MCP :

**Claude Code** (`~/.claude/settings.json`) :

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

---

### HTTP — intégration externe

Démarrez le serveur en mode HTTP avec le flag `--http` :

```bash
node dist/index.js --http          # Port par défaut : 3100
node dist/index.js --http 8080     # Port personnalisé
```

Le serveur expose :

| Endpoint | Méthode | Auth | Description |
|----------|---------|------|-------------|
| `POST /mcp` | POST | Bearer ¹ | Session MCP (initialize + tool calls) |
| `GET /mcp` | GET | — | Page d'information HTML (navigateur) |
| `GET /health` | GET | — | Health check JSON avec stats du cache warmer |
| `GET /admin/status` | GET | Secret ² | Uptime, état circuit breaker, taille cache, Redis |
| `POST /admin/warm` | POST | Cron / Secret ² | Préchauffage manuel du cache par exchange |

¹ Requis si `MCP_API_KEYS` est configuré.  
² Via header `x-vercel-cron: 1` (Vercel Cron) ou query `?secret=MCP_ADMIN_SECRET`.

**Exemple d'appel depuis une application :**

```bash
# 1. Initialiser la session
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ma-cle-secrete" \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "mon-app", "version": "1.0" }
    }
  }'

# 2. Appeler un outil (SESSION_ID = valeur du header mcp-session-id reçu)
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer ma-cle-secrete" \
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

---

### Vercel — déploiement serverless

```bash
vercel deploy --prod
```

Variables d'environnement à configurer sur Vercel :

```bash
vercel env add MCP_API_KEYS production
vercel env add MCP_ADMIN_SECRET production
vercel env add REDIS_URL production          # optionnel — cache L2
vercel env add AFRICAN_MARKETS_USERNAME production  # optionnel — premium
vercel env add AFRICAN_MARKETS_PASSWORD production
```

> Désactivez le cache warmer en serverless — `CACHE_WARMING_ENABLED=false` est la valeur par défaut sur Vercel.

---

### Docker

```bash
# Build
docker build -t cc-financial-markets-mcp .

# Mode stdio (pipe JSON-RPC)
docker run --rm -i cc-financial-markets-mcp

# Mode HTTP
docker run --rm -p 3100:3100 \
  -e CACHE_WARMING_ENABLED=false \
  -e MCP_API_KEYS=ma-cle-secrete \
  cc-financial-markets-mcp --http 3100
```

---

## Référence des outils

### `list_exchanges`

Liste toutes les places de marché supportées, avec filtrage optionnel par pays.

```json
{ "country": "Kenya" }
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
├── index.ts                     # Point d'entrée — McpServer + transport stdio/HTTP
│                                # Endpoints: /mcp, /health, /admin/status, /admin/warm
├── config.ts                    # Configuration via variables d'environnement
├── logger.ts                    # Logger JSON structuré → stderr (stdout réservé MCP)
├── auth-mcp.ts                  # Authentification Bearer (MCP_API_KEYS, timingSafeEqual)
├── inbound-rate-limiter.ts      # Rate limiter inbound par fingerprint de clé API
├── http-logger.ts               # Logging structuré des requêtes HTTP entrantes
├── types/
│   └── markets.ts               # Types domaine + AFRICAN_EXCHANGES (20 bourses, 3 providers)
├── cache/
│   ├── cache.ts                 # Cache TTL en mémoire (Map, sans dépendance externe)
│   ├── redis-cache.ts           # Cache L2 Redis (optionnel, ioredis)
│   └── warmer.ts                # Cache warmer adaptatif (5 min trading, 60 min hors séance)
├── scraper/
│   ├── rate-limiter.ts          # Token bucket partagé (requêtes/minute outbound)
│   ├── circuit-breaker.ts       # Circuit breaker CLOSED/OPEN/HALF_OPEN avec cooldown
│   ├── fetcher.ts               # Fetch HTTP avec User-Agent, retry, cache, circuit breaker
│   ├── auth.ts                  # Authentification premium (cookie de session)
│   ├── parser.ts                # Parseurs Cheerio pour les tables DOM d'african-markets.com
│   ├── index-history-parser.ts  # Extraction du chartData JS inline (historique indices)
│   ├── stock-history-parser.ts  # Extraction OHLCV depuis les pages profil (premium)
│   └── strategies/
│       ├── sgbv.ts              # Scraper direct API sgbv.dz (Algérie)
│       └── bvmac.ts             # Scraper direct API bosxch.bvm-ac.org (CEMAC)
└── tools/
    ├── list-exchanges.ts         # Fonction pure, pas de scraping
    ├── market-data.ts            # Stocks, movers, indices (+ routing vers strategies/)
    ├── annual-reports.ts         # Publications edocman avec pagination
    ├── market-news.ts            # Actualités homepage (Raxo)
    ├── company-profile.ts        # Profil complet entreprise
    ├── company-documents.ts      # Documents complets entreprise
    ├── index-history.ts          # Historique indice avec filtrage par période
    └── stock-history.ts          # Historique OHLCV avec filtrage par période
```

### Flux de données

```
Client MCP
    │
    ├─── Auth Bearer (MCP_API_KEYS)
    ├─── Rate limit inbound (par fingerprint clé)
    ▼
index.ts (dispatch)
    │
    ▼
tools/*.ts (handler + validation Zod)
    │
    ├── SGBV / BVMAC → scraper/strategies/* (API directe)
    │
    └── Autres bourses
            │
            ▼
        Fetcher
            ├── Cache L1 mémoire  (hit → retour immédiat)
            ├── Cache L2 Redis    (hit → retour immédiat)
            ├── Circuit breaker   (OPEN → CircuitOpenError)
            ├── Rate limiter      (token bucket outbound)
            └── HTTP fetch + retry
                    │
                    ▼
            african-markets.com
                    │
                    ▼
            parser.ts / *-parser.ts (Cheerio → types domaine)
                    │
                    ├── Écriture cache L1 + L2
                    ▼
JSON sérialisé → réponse MCP
```

### Circuit breaker

Le `CircuitBreaker` wrappé dans `Fetcher` protège contre les pannes du scraper :

| État | Comportement |
|------|-------------|
| `CLOSED` | Normal — les erreurs s'accumulent vers le seuil (`CIRCUIT_BREAKER_THRESHOLD`) |
| `OPEN` | Court-circuit immédiat → `CircuitOpenError` — attente du cooldown (`CIRCUIT_BREAKER_TIMEOUT_SECONDS`) |
| `HALF_OPEN` | Une probe est envoyée — si elle réussit : retour `CLOSED` ; si elle échoue : retour `OPEN` |

L'état courant est visible via `GET /admin/status`.

### Décisions de conception

- **Stdout réservé** — tout le logging passe par stderr. Stdout est exclusivement pour le JSON-RPC MCP.
- **User-Agent navigateur** — le site est derrière Cloudflare ; une requête sans UA standard reçoit une 403.
- **Pas de base de données** — les données sont éphémères, récupérées à la demande avec cache TTL mémoire + Redis L2 optionnel.
- **Rate limiter partagé** — une seule instance `RateLimiter` entre tous les outils pour respecter les limites du site.
- **Cache warmer adaptatif** — pendant les heures de trading (n'importe quelle bourse ouverte) : refresh toutes les 5 min ; hors séance : toutes les 60 min.
- **Format français** — le site est scrapé via `/fr`. Le parsing des nombres gère le format français (ex: `1 234,56`).
- **Pattern strategy pour SGBV/BVMAC** — ces bourses ont leurs propres APIs JSON et sont traitées via des scrapers dédiés dans `scraper/strategies/`, sans passer par le `Fetcher` africain-markets.

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

# Tests d'intégration (nécessite npm run build)
npm run test:integration

# Tous les tests (unitaires + intégration)
npm run test:all
```

Les tests d'intégration (`tests/integration/`) démarrent le serveur compilé sur des ports dédiés et vérifient le comportement HTTP réel : sessions MCP, rate limiting 429, cycle de vie du circuit breaker, et authentification Bearer.

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
{
  name: "Nom de la bourse",
  code: "CODE",
  country: "Pays",
  currency: "DEV",
  url: "slug-du-site",
  provider: "african-markets"  // ou "sgbv" | "bvmac" pour API directe
}
```

Pour une bourse avec API dédiée, créez aussi un scraper dans `src/scraper/strategies/` et branchez-le dans `src/tools/market-data.ts`.

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
