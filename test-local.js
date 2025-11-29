/**
 * Test local del scraper de MercadoLibre
 * Uso: node test-local.js
 */

const { chromium } = require('playwright');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function extractPropertyData(page, url) {
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
            const rows = document.querySelectorAll('tr.andes-table__row');
            for (const row of rows) {
                const header = row.querySelector('th.andes-table__header');
                const column = row.querySelector('td.andes-table__column');

                if (header && column && header.textContent.trim().toLowerCase().includes(label.toLowerCase())) {
                    return column.textContent.trim();
                }
            }
            return '';
        };

        // Detectar bloqueo
        const isBlockedPage = document.querySelector('.account-verification-main') ||
                             document.body.textContent.includes('Para continuar, ingresa a') ||
                             document.body.textContent.includes('¡Hola! Para continuar');

        if (isBlockedPage) {
            return {
                success: false,
                error: 'blocked',
                message: 'MercadoLibre está mostrando página de login',
                pageTitle: document.title,
                bodyPreview: document.body.textContent.substring(0, 300)
            };
        }

        const title = extractText('h1.ui-pdp-title') || extractText('h1');
        const priceText = extractText('span.andes-money-amount__fraction');
        const currencySymbol = extractText('span.andes-money-amount__currency-symbol');
        const currency = currencySymbol.includes('U') ? 'USD' : 'ARS';
        const price = extractNumericValue(priceText) || 0;
        const description = extractText('p.ui-pdp-description__content');

        const metrosTotales = extractNumericValue(getFeature('Superficie total'));
        const metrosCubiertos = extractNumericValue(getFeature('Superficie cubierta'));
        const ambientes = extractNumericValue(getFeature('Ambientes'));
        const dormitorios = extractNumericValue(getFeature('Dormitorios'));
        const banos = extractNumericValue(getFeature('Baños') || getFeature('Baño'));
        const cocheras = extractNumericValue(getFeature('Cocheras'));
        const antiguedad = extractNumericValue(getFeature('Antigüedad'));

        const images = [];
        document.querySelectorAll('figure.ui-pdp-gallery__figure img').forEach(img => {
            const src = img.getAttribute('data-zoom') || img.getAttribute('src');
            if (src && src.startsWith('http')) {
                images.push(src.replace('-I.', '-O.').replace('-F.', '-O.'));
            }
        });

        let codigoPublicacion = '';
        const mlaMatch = currentUrl.match(/(MLA-?\d+)/i);
        if (mlaMatch) {
            codigoPublicacion = mlaMatch[1].replace('-', '');
        }

        return {
            success: !!title,
            title,
            price,
            currency,
            description,
            images: [...new Set(images)],
            metros_totales: metrosTotales,
            metros_cubiertos: metrosCubiertos,
            ambientes,
            dormitorios,
            banos,
            cocheras,
            antiguedad,
            codigo_publicacion: codigoPublicacion,
            url: currentUrl,
            source: 'mercadolibre'
        };
    }, url);

    return data;
}

async function main() {
    // URL de prueba
    const testUrl = process.argv[2] || 'https://inmueble.mercadolibre.com.ar/MLA-2402497778-venta-ph-belgrano-r-2-ambientes-_JM';

    console.log('🚀 Test local del scraper MercadoLibre');
    console.log(`📍 URL: ${testUrl}\n`);

    const browser = await chromium.launch({
        headless: process.env.APIFY_HEADLESS !== 'false',
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires'
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });
        window.chrome = { runtime: {} };
    });

    try {
        // Calentar sesión
        console.log('🔥 Calentando sesión...');
        await page.goto('https://listado.mercadolibre.com.ar/inmuebles/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await new Promise(r => setTimeout(r, 3000));

        // Navegar a la propiedad
        console.log('📍 Navegando a la propiedad...');
        await page.goto(testUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        // Esperar carga
        console.log('⏳ Esperando carga...');
        await new Promise(r => setTimeout(r, 5000));

        // Scroll
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await new Promise(r => setTimeout(r, 2000));

        // Extraer datos
        console.log('📊 Extrayendo datos...\n');
        const data = await extractPropertyData(page, testUrl);

        // Mostrar resultados
        console.log('=' .repeat(50));
        console.log('📋 RESULTADOS');
        console.log('=' .repeat(50));

        if (data.success) {
            console.log(`✅ Éxito: ${data.success}`);
            console.log(`🏠 Título: ${data.title}`);
            console.log(`💰 Precio: ${data.currency} ${data.price.toLocaleString()}`);
            console.log(`📝 Descripción: ${data.description?.substring(0, 100) || 'N/A'}...`);
            console.log(`🛏️ Dormitorios: ${data.dormitorios || 'N/A'}`);
            console.log(`🚿 Baños: ${data.banos || 'N/A'}`);
            console.log(`🏢 Ambientes: ${data.ambientes || 'N/A'}`);
            console.log(`📐 Superficie total: ${data.metros_totales || 'N/A'}m²`);
            console.log(`📐 Superficie cubierta: ${data.metros_cubiertos || 'N/A'}m²`);
            console.log(`🚗 Cocheras: ${data.cocheras || 'N/A'}`);
            console.log(`🏗️ Antigüedad: ${data.antiguedad || 'N/A'} años`);
            console.log(`🔑 Código: ${data.codigo_publicacion}`);
            console.log(`📸 Imágenes: ${data.images?.length || 0}`);

            if (data.images?.length > 0) {
                console.log('\n🖼️ Primeras 3 imágenes:');
                data.images.slice(0, 3).forEach((img, i) => {
                    console.log(`   ${i + 1}. ${img.substring(0, 80)}...`);
                });
            }
        } else {
            console.log(`❌ Error: ${data.error || data.message}`);
            if (data.bodyPreview) {
                console.log(`\n📄 Preview de la página:\n${data.bodyPreview}`);
            }
        }

        console.log('\n' + '=' .repeat(50));

        // Guardar screenshot
        const screenshotPath = `/tmp/meli_test_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`📸 Screenshot guardado en: ${screenshotPath}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await browser.close();
    }
}

main();
