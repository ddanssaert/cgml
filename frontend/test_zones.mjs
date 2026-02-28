import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', async msg => {
      const args = await Promise.all(msg.args().map(a => a.jsonValue().catch(() => a.toString())));
      console.log(`[BROWSER ${msg.type()}]`, ...args);
  });
  page.on('pageerror', err => {
      console.log('[PAGE ERROR]', err.toString());
  });
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('button.load-btn');
  await page.click('button.load-btn');
  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
})();
