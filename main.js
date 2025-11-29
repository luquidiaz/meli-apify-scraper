const { Actor } = require('apify');
const { chromium } = require('playwright');

// User agents rotativos para parecer más humano
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Validar que sea una URL de MercadoLibre
function validateMercadoLibreUrl(url) {
    const patterns = [
        /mercadolibre\.com\.ar/i,
        /inmueble\.mercadolibre/i,
        /casa\.mercadolibre/i,
        /departamento\.mercadolibre/i,
        /terreno\.mercadolibre/i,
    ];
    return patterns.some(pattern => pattern.test(url));
}

// Extraer ID del item de la URL
function extractItemId(url) {
    const patterns = [
        /MLA-?(\d+)/i,
        /\/(\d+)-/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return `MLA${match[1]}`;
        }
    }
    return null;
}

// Función principal de extracción de datos
async function extractPropertyData(page, url) {
    console.log('📊 Extrayendo datos de la propiedad...');

    const data = await page.evaluate((currentUrl) => {
        const extractText = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent.trim() : '';
        };

        const extractNumericValue = (value) => {
            if (!value) return null;
            const match = value.match(/[\d.,]+/);
            if (match) {
                // Convertir formato argentino (. miles, , decimal) a número
                const num = match[0].replace(/\./g, '').replace(',', '.');
                return parseFloat(num) || null;
            }
            return null;
        };

        const getFeature = (label) => {
            const rows = document.querySelectorAll('tr.andes-table__row, .ui-pdp-specs__table .andes-table__row');
            for (const row of rows) {
                const header = row.querySelector('th.andes-table__header, .andes-table__header');
                const column = row.querySelector('td.andes-table__column, .andes-table__column');

                if (header && column && header.textContent.trim().toLowerCase().includes(label.toLowerCase())) {
                    return column.textContent.trim();
                }
            }
            return '';
        };

        // Detectar página de verificación/login
        const isBlockedPage = document.querySelector('.account-verification-main') ||
                             document.body.textContent.includes('Para continuar, ingresa a') ||
                             document.body.textContent.includes('¡Hola! Para continuar') ||
                             document.querySelector('.andes-button--loud[href*="login"]');

        if (isBlockedPage) {
            return {
                success: false,
                error: 'blocked',
                message: 'MercadoLibre está mostrando página de login/verificación',
                url: currentUrl,
                pageTitle: document.title,
                bodyPreview: document.body.textContent.substring(0, 500)
            };
        }

        // Título
        const title = extractText('h1.ui-pdp-title') ||
                     extractText('h1[class*="title"]') ||
                     extractText('h1');

        // Precio
        const priceText = extractText('span.andes-money-amount__fraction');
        const currencySymbol = extractText('span.andes-money-amount__currency-symbol');
        const currency = currencySymbol.includes('U') || currencySymbol.includes('$') && priceText.includes('USD') ? 'USD' : 'ARS';
        const price = extractNumericValue(priceText) || 0;

        // Descripción
        const description = extractText('p.ui-pdp-description__content') ||
                           extractText('.ui-pdp-description__content') ||
                           '';

        // Tipo de operación
        const subtitle = extractText('div.ui-pdp-header__subtitle span.ui-pdp-subtitle') ||
                        extractText('.ui-pdp-subtitle');
        const operationType = subtitle.toLowerCase().includes('alquiler') ||
                             title.toLowerCase().includes('alquiler') ? 'rent' : 'sale';

        // Características
        const metrosTotales = extractNumericValue(getFeature('Superficie total'));
        const metrosCubiertos = extractNumericValue(getFeature('Superficie cubierta'));
        const ambientes = extractNumericValue(getFeature('Ambientes'));
        const dormitorios = extractNumericValue(getFeature('Dormitorios'));
        const banos = extractNumericValue(getFeature('Baños') || getFeature('Baño'));
        const cocheras = extractNumericValue(getFeature('Cocheras') || getFeature('Cochera'));
        const antiguedad = extractNumericValue(getFeature('Antigüedad'));

        // Expensas
        let expensas = 0;
        const expensasElement = document.querySelector('.ui-pdp-color--GRAY.ui-pdp-size--XSMALL.ui-pdp-family--REGULAR.ui-pdp-maintenance-fee-ltr');
        if (expensasElement) {
            expensas = extractNumericValue(expensasElement.textContent) || 0;
        } else {
            expensas = extractNumericValue(getFeature('Expensas')) || 0;
        }

        // Código de publicación
        let codigoPublicacion = '';
        const mlaMatch = currentUrl.match(/(MLA-?\d+)/i);
        if (mlaMatch) {
            codigoPublicacion = mlaMatch[1].replace('-', '');
        }

        // Imágenes
        const images = [];
        const imgSelectors = [
            'figure.ui-pdp-gallery__figure img',
            '.ui-pdp-gallery__figure img',
            '.ui-pdp-image img',
            'img[data-zoom]'
        ];

        for (const selector of imgSelectors) {
            document.querySelectorAll(selector).forEach(img => {
                const src = img.getAttribute('data-zoom') ||
                           img.getAttribute('data-src') ||
                           img.getAttribute('src');
                if (src && src.startsWith('http') && !images.includes(src)) {
                    // Convertir a máxima resolución
                    let highResSrc = src;
                    if (src.includes('-I.')) {
                        highResSrc = src.replace('-I.', '-O.');
                    } else if (src.includes('-F.')) {
                        highResSrc = src.replace('-F.', '-O.');
                    }
                    images.push(highResSrc);
                }
            });
        }

        // Coordenadas del mapa
        let latitude = null, longitude = null;
        const mapImg = document.querySelector('img[src*="maps.googleapis.com"]');
        if (mapImg) {
            const src = mapImg.getAttribute('src');
            const centerMatch = src?.match(/center=([-\d.]+)%2C([-\d.]+)/);
            if (centerMatch) {
                latitude = parseFloat(centerMatch[1]);
                longitude = parseFloat(centerMatch[2]);
            }
        }

        // Ubicación
        const location = extractText('.ui-pdp-media__title') ||
                        extractText('.ui-pdp-location') ||
                        extractText('.ui-vip-location') ||
                        subtitle;

        // Verificar si obtuvimos datos válidos
        const hasValidData = title && (price > 0 || images.length > 0);

        return {
            success: hasValidData,
            title: title || '',
            price: price,
            currency: currency,
            description: description,
            images: images,
            metros_totales: metrosTotales,
            metros_cubiertos: metrosCubiertos,
            ambientes: ambientes,
            dormitorios: dormitorios,
            banos: banos,
            cocheras: cocheras,
            antiguedad: antiguedad,
            expensas: expensas,
            codigo_publicacion: codigoPublicacion,
            url: currentUrl,
            source: 'mercadolibre',
            operation_type: operationType,
            location: location,
            latitude: latitude,
            longitude: longitude,
            _metadata: {
                scrapedAt: new Date().toISOString(),
                pageTitle: document.title,
                imagesCount: images.length
            }
        };
    }, url);

    return data;
}

// Configurar browser con anti-detección
async function setupBrowser() {
    const userAgent = getRandomUserAgent();
    console.log(`🔧 User-Agent: ${userAgent.substring(0, 50)}...`);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
        ]
    });

    const context = await browser.newContext({
        userAgent: userAgent,
        viewport: { width: 1920, height: 1080 },
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
        geolocation: { latitude: -34.6037, longitude: -58.3816 },
        permissions: ['geolocation'],
        extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
        }
    });

    const page = await context.newPage();

    // Scripts anti-detección
    await page.addInitScript(() => {
        // Ocultar webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // Plugins realistas
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' }
            ]
        });

        // Propiedades del navegador
        Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

        // Chrome runtime
        window.chrome = { runtime: {} };
    });

    return { browser, context, page };
}

// Función principal
async function main() {
    await Actor.init();

    const startTime = Date.now();
    console.log('🚀 MercadoLibre Real Estate Scraper iniciando...');

    let browser = null;

    try {
        // Obtener input
        const input = await Actor.getInput();

        if (!input || !input.url) {
            throw new Error('URL es requerida. Formato: {"url": "https://inmueble.mercadolibre.com.ar/MLA-..."}');
        }

        const { url, includeHtml = false, includeScreenshot = false } = input;

        console.log(`🎯 URL objetivo: ${url}`);

        // Validar URL
        if (!validateMercadoLibreUrl(url)) {
            throw new Error(`URL no válida. Debe ser de MercadoLibre Argentina.`);
        }

        const itemId = extractItemId(url);
        console.log(`🔑 Item ID: ${itemId}`);

        // Configurar browser
        const { browser: b, context, page } = await setupBrowser();
        browser = b;

        // Navegar primero a listados para "calentar" la sesión
        console.log('🔥 Calentando sesión...');
        await page.goto('https://listado.mercadolibre.com.ar/inmuebles/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Delay humano
        const warmupDelay = getRandomDelay(3000, 5000);
        console.log(`⏳ Esperando ${warmupDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, warmupDelay));

        // Navegar a la propiedad objetivo
        console.log('📍 Navegando a la propiedad...');
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        // Esperar que cargue el contenido
        const loadDelay = getRandomDelay(4000, 6000);
        console.log(`⏳ Esperando carga de contenido (${loadDelay/1000}s)...`);
        await new Promise(resolve => setTimeout(resolve, loadDelay));

        // Scroll para activar lazy loading
        console.log('📜 Haciendo scroll...');
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 3);
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Extraer datos
        const propertyData = await extractPropertyData(page, url);

        // Screenshot opcional
        let screenshotBase64 = null;
        if (includeScreenshot) {
            console.log('📸 Tomando screenshot...');
            const screenshot = await page.screenshot({ fullPage: false });
            screenshotBase64 = screenshot.toString('base64');
        }

        // HTML opcional
        let html = null;
        if (includeHtml) {
            html = await page.content();
        }

        await browser.close();
        browser = null;

        const duration = Date.now() - startTime;

        // Preparar resultado
        const result = {
            ...propertyData,
            metadata: {
                ...propertyData._metadata,
                scrapingDuration: duration,
                itemId: itemId,
                ...(includeScreenshot && screenshotBase64 && { screenshotBase64 }),
                ...(includeHtml && html && { htmlLength: html.length })
            }
        };

        // Eliminar _metadata duplicado
        delete result._metadata;

        // Agregar HTML si se solicitó
        if (includeHtml && html) {
            result.html = html;
        }

        // Logging de resultado
        console.log('\n✅ Scraping completado');
        console.log(`⏱️ Duración: ${(duration / 1000).toFixed(2)}s`);
        console.log(`📊 Éxito: ${result.success}`);

        if (result.success) {
            console.log(`🏠 Título: ${result.title}`);
            console.log(`💰 Precio: ${result.currency} ${result.price}`);
            console.log(`🛏️ Dormitorios: ${result.dormitorios || 'N/A'}`);
            console.log(`🚿 Baños: ${result.banos || 'N/A'}`);
            console.log(`📐 Superficie: ${result.metros_totales || 'N/A'}m²`);
            console.log(`📸 Imágenes: ${result.images?.length || 0}`);
        } else {
            console.log(`❌ Error: ${result.error || result.message}`);
        }

        // Guardar resultado
        await Actor.pushData(result);
        await Actor.setValue('OUTPUT', result);

        console.log('💾 Resultado guardado');

    } catch (error) {
        console.error('💥 Error:', error.message);

        const errorResult = {
            success: false,
            error: error.message,
            url: (await Actor.getInput())?.url || 'unknown',
            scrapedAt: new Date().toISOString()
        };

        await Actor.pushData(errorResult);
        await Actor.setValue('OUTPUT', errorResult);

    } finally {
        if (browser) {
            await browser.close();
        }
        await Actor.exit();
    }
}

main().catch(async (error) => {
    console.error('Error fatal:', error);
    await Actor.exit('Actor failed', { exitCode: 1 });
});
