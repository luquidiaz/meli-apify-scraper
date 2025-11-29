# MercadoLibre Real Estate Scraper

Actor de Apify para hacer scraping de propiedades inmobiliarias de MercadoLibre Argentina.

## Características

- Extracción de datos completos de propiedades inmobiliarias
- Técnicas anti-detección avanzadas
- Soporte para múltiples subdominios de MercadoLibre (inmueble, casa, departamento, terreno)
- Extracción de imágenes en alta resolución
- Coordenadas geográficas del mapa

## Input

```json
{
  "url": "https://inmueble.mercadolibre.com.ar/MLA-2402497778-...",
  "includeHtml": false,
  "includeScreenshot": false
}
```

### Parámetros

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `url` | string | Sí | URL de la propiedad en MercadoLibre |
| `includeHtml` | boolean | No | Incluir HTML crudo en la respuesta |
| `includeScreenshot` | boolean | No | Incluir screenshot en base64 |

## Output

```json
{
  "success": true,
  "title": "Venta PH Belgrano R 2 Ambientes",
  "price": 85000,
  "currency": "USD",
  "description": "...",
  "images": ["https://..."],
  "metros_totales": 45,
  "metros_cubiertos": 42,
  "ambientes": 2,
  "dormitorios": 1,
  "banos": 1,
  "cocheras": null,
  "antiguedad": 50,
  "expensas": 25000,
  "codigo_publicacion": "MLA2402497778",
  "url": "https://...",
  "source": "mercadolibre",
  "operation_type": "sale",
  "location": "Belgrano R, Capital Federal",
  "latitude": -34.5678,
  "longitude": -58.4567,
  "metadata": {
    "scrapedAt": "2024-11-29T12:00:00Z",
    "scrapingDuration": 15000,
    "imagesCount": 10
  }
}
```

## Campos extraídos

| Campo | Descripción |
|-------|-------------|
| `title` | Título de la publicación |
| `price` | Precio numérico |
| `currency` | Moneda (USD o ARS) |
| `description` | Descripción completa |
| `images` | Array de URLs de imágenes en alta resolución |
| `metros_totales` | Superficie total en m² |
| `metros_cubiertos` | Superficie cubierta en m² |
| `ambientes` | Cantidad de ambientes |
| `dormitorios` | Cantidad de dormitorios |
| `banos` | Cantidad de baños |
| `cocheras` | Cantidad de cocheras |
| `antiguedad` | Antigüedad en años |
| `expensas` | Valor de expensas |
| `codigo_publicacion` | ID de MercadoLibre (MLA...) |
| `operation_type` | "sale" o "rent" |
| `location` | Ubicación/barrio |
| `latitude` / `longitude` | Coordenadas GPS |

## Desarrollo local

```bash
# Instalar dependencias
npm install

# Instalar navegadores de Playwright
npx playwright install chromium

# Ejecutar test local
npm test

# Test con URL específica
node test-local.js "https://inmueble.mercadolibre.com.ar/MLA-..."

# Test con navegador visible (debug)
npm run test:debug
```

## Deploy en Apify

```bash
# Login en Apify
apify login

# Push del actor
apify push
```

## Notas

- El scraper usa técnicas de session warming navegando primero a listados
- Incluye delays aleatorios para parecer más humano
- User-Agent rotativo entre Chrome 130/131
- Anti-detección para evitar bloqueos de MercadoLibre
