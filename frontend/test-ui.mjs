import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
    page.on('response', response => {
        if (!response.ok()) console.error('HTTP ERROR:', response.status(), response.url());
    });

    await page.goto('http://localhost:5175', { waitUntil: 'networkidle0' });
    await browser.close();
})();
