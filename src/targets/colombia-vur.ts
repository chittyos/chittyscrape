import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, type ScraperModule } from './base';

export interface VurResult {
  success: boolean;
  data?: any;
  error?: string;
}

export async function scrapeColombiaVur(browser: any, matricula: string, oficinaRegistro: string): Promise<VurResult> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto('https://certificados.supernotariado.gov.co/certificado', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const oficinaInputId = 'formOficinas\\:autoCompleteOficinas_input';
    const matriculaInputId = 'formOficinas\\:inpMatricula';
    const searchBtnId = 'formOficinas\\:btnBuscar';

    await page.waitForSelector('#' + matriculaInputId.replace(/\\:/g, '\\:'));

    await page.type('#' + oficinaInputId.replace(/\\:/g, '\\:'), oficinaRegistro);
    // Wait for the primefaces dropdown item
    await page.waitForSelector('.ui-autocomplete-item', { timeout: 10000 });
    await page.click('.ui-autocomplete-item');

    await page.type('#' + matriculaInputId.replace(/\\:/g, '\\:'), matricula);

    await Promise.all([
      page.click('#' + searchBtnId.replace(/\\:/g, '\\:')),
      page.waitForFunction(() => {
        const pCarrito = (globalThis as any).document.querySelector('#panelCarrito');
        const pResultados = (globalThis as any).document.querySelector('#panelResultados');
        return (pCarrito && pCarrito.innerHTML.trim().length > 0) || 
               (pResultados && pResultados.innerHTML.trim().length > 0);
      }, { timeout: 30000 }).catch(() => {})
    ]);

    const resultData = await page.evaluate(() => {
      const modal = (globalThis as any).document.querySelector('#modalMatriculaCarrito_content');
      if (modal) {
        return { status: 'FOUND', details: (modal as any).innerText };
      }
      return { status: 'UNKNOWN_OR_NOT_FOUND', details: (globalThis as any).document.body.innerText.slice(0, 1000) };
    });

    return {
      success: true,
      data: {
        matricula,
        oficinaRegistro,
        status: resultData.status,
        details: resultData.details
      }
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const colombiaVurScraper: ScraperModule<{ matricula: string; oficina_registro?: string; auto_pay?: boolean }, any> = {
  meta: {
    id: 'colombia-vur',
    name: 'Colombia VUR Certificado de Tradicion',
    category: 'governance',
    version: '0.2.0',
    requiresAuth: false,
  },
  async execute(browser, env, input) {
    if (!input?.matricula) {
      return wrapResult('colombia-vur', false, undefined, 'matricula is required');
    }
    const result = await scrapeColombiaVur(browser, input.matricula, input.oficina_registro || '01N');
    return wrapResult('colombia-vur', result.success, result.data, result.error);
  }
};
