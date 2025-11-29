const { Actor } = require('apify');
const { PlaywrightCrawler, ProxyConfiguration } = require('crawlee');

// User agents rotativos para parecer más humano
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
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
            'figure.gallery-image img.gallery-image__image',
            'figure.gallery-image img',
            '.vis-gallery-mosaic img',
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
                    let highResSrc = src;
                    // Convertir a alta resolución: -F y -I a -O
                    if (src.includes('-F-null.')) {
                        highResSrc = src.replace('-F-null.', '-O.');
                    } else if (src.includes('-F.')) {
                        highResSrc = src.replace('-F.', '-O.');
                    } else if (src.includes('-I.')) {
                        highResSrc = src.replace('-I.', '-O.');
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

// Función principal
async function main() {
    await Actor.init();

    const startTime = Date.now();
    console.log('🚀 MercadoLibre Real Estate Scraper iniciando...');

    try {
        const input = await Actor.getInput();

        if (!input || !input.url) {
            throw new Error('URL es requerida. Formato: {"url": "https://inmueble.mercadolibre.com.ar/MLA-..."}');
        }

        const {
            url,
            includeHtml = false,
            includeScreenshot = true,
            useProxy = true,
            proxyCountry = 'AR'
        } = input;

        console.log(`🎯 URL objetivo: ${url}`);

        if (!validateMercadoLibreUrl(url)) {
            throw new Error(`URL no válida. Debe ser de MercadoLibre Argentina.`);
        }

        const itemId = extractItemId(url);
        console.log(`🔑 Item ID: ${itemId}`);

        const userAgent = getRandomUserAgent();
        console.log(`🔧 User-Agent: ${userAgent.substring(0, 50)}...`);

        // Configurar proxy de Apify (residencial de Argentina)
        let proxyConfiguration = null;
        if (useProxy) {
            console.log(`🌐 Configurando proxy residencial (${proxyCountry})...`);
            proxyConfiguration = await Actor.createProxyConfiguration({
                groups: ['RESIDENTIAL'],
                countryCode: proxyCountry,
            });
            console.log('✅ Proxy configurado');
        }

        let propertyData = null;
        let screenshotBase64 = null;
        let html = null;

        const crawler = new PlaywrightCrawler({
            maxRequestsPerCrawl: 1, // Solo la URL objetivo, sin warmup
            requestHandlerTimeoutSecs: 120,
            navigationTimeoutSecs: 60,
            headless: true,

            // Usar proxy si está configurado
            proxyConfiguration,

            launchContext: {
                launchOptions: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-features=VizDisplayCompositor',
                    ]
                }
            },

            browserPoolOptions: {
                useFingerprints: true, // Habilitar fingerprints para más realismo
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        browsers: ['chrome'],
                        devices: ['desktop'],
                        operatingSystems: ['windows', 'macos'],
                        locales: ['es-AR', 'es'],
                    }
                }
            },

            preNavigationHooks: [
                async ({ page, request }) => {
                    // Headers más completos
                    await page.setExtraHTTPHeaders({
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0',
                        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                    });

                    // Anti-detección avanzada
                    await page.addInitScript(() => {
                        // Ocultar webdriver
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                        delete navigator.__proto__.webdriver;

                        // Chrome runtime
                        window.chrome = {
                            runtime: {},
                            loadTimes: function() {},
                            csi: function() {},
                            app: {}
                        };

                        // Plugins realistas
                        Object.defineProperty(navigator, 'plugins', {
                            get: () => {
                                const plugins = [
                                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                                ];
                                plugins.length = 3;
                                return plugins;
                            }
                        });

                        // Languages
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['es-AR', 'es', 'en-US', 'en']
                        });

                        // Hardware concurrency
                        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

                        // Permissions
                        const originalQuery = window.navigator.permissions.query;
                        window.navigator.permissions.query = (parameters) => (
                            parameters.name === 'notifications' ?
                                Promise.resolve({ state: Notification.permission }) :
                                originalQuery(parameters)
                        );

                        // WebGL vendor
                        const getParameter = WebGLRenderingContext.prototype.getParameter;
                        WebGLRenderingContext.prototype.getParameter = function(parameter) {
                            if (parameter === 37445) return 'Intel Inc.';
                            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                            return getParameter.call(this, parameter);
                        };
                    });
                }
            ],

            async requestHandler({ page, request }) {
                const currentUrl = request.url;
                console.log(`📍 Procesando: ${currentUrl}`);

                // Esperar carga inicial
                console.log('⏳ Esperando carga...');
                await new Promise(r => setTimeout(r, getRandomDelay(3000, 5000)));

                // Movimientos de mouse aleatorios para parecer humano
                console.log('🖱️ Simulando interacción humana...');
                await page.mouse.move(
                    100 + Math.random() * 500,
                    100 + Math.random() * 300
                );
                await new Promise(r => setTimeout(r, getRandomDelay(500, 1000)));

                // Scroll suave para lazy loading
                console.log('📜 Haciendo scroll...');
                await page.evaluate(() => {
                    return new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= document.body.scrollHeight / 2) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });
                await new Promise(r => setTimeout(r, getRandomDelay(1500, 2500)));

                // Extraer datos
                propertyData = await extractPropertyData(page, currentUrl);

                // Screenshot siempre para debug
                if (includeScreenshot || !propertyData.success) {
                    console.log('📸 Tomando screenshot...');
                    const screenshot = await page.screenshot({ fullPage: false });
                    screenshotBase64 = screenshot.toString('base64');

                    // Guardar screenshot en key-value store para poder verlo
                    await Actor.setValue('SCREENSHOT', screenshot, { contentType: 'image/png' });
                }

                // HTML opcional
                if (includeHtml || !propertyData.success) {
                    html = await page.content();
                    await Actor.setValue('HTML', html, { contentType: 'text/html' });
                }
            },

            failedRequestHandler({ request, error }) {
                console.error(`❌ Request fallido: ${request.url}`, error.message);
            }
        });

        // Correr el crawler solo con la URL objetivo
        await crawler.run([url]);

        const duration = Date.now() - startTime;

        if (!propertyData) {
            throw new Error('No se pudieron extraer datos de la propiedad');
        }

        // Preparar resultado
        const result = {
            ...propertyData,
            metadata: {
                ...propertyData._metadata,
                scrapingDuration: duration,
                itemId: itemId,
                usedProxy: useProxy,
                proxyCountry: useProxy ? proxyCountry : null,
                ...(includeScreenshot && screenshotBase64 && { screenshotBase64 }),
                ...(includeHtml && html && { htmlLength: html.length })
            }
        };

        delete result._metadata;

        if (includeHtml && html) {
            result.html = html;
        }

        // Logging
        console.log('\n✅ Scraping completado');
        console.log(`⏱️ Duración: ${(duration / 1000).toFixed(2)}s`);
        console.log(`📊 Éxito: ${result.success}`);

        if (result.success) {
            console.log(`🏠 Título: ${result.title}`);
            console.log(`💰 Precio: ${result.currency} ${result.price}`);
            console.log(`🛏️ Dormitorios: ${result.dormitorios || 'N/A'}`);
            console.log(`📸 Imágenes: ${result.images?.length || 0}`);
        } else {
            console.log(`❌ Error: ${result.error || result.message}`);
            if (result.bodyPreview) {
                console.log(`📄 Preview: ${result.bodyPreview.substring(0, 200)}...`);
            }
        }

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
    }

    await Actor.exit();
}

main().catch(async (error) => {
    console.error('Error fatal:', error);
    await Actor.exit('Actor failed', { exitCode: 1 });
});
