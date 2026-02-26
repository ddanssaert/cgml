import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.goto('http://localhost:5175', { waitUntil: 'networkidle0' });
    
    // Start game
    await page.click('.load-btn');
    await page.waitForSelector('.game-board');
    await page.waitForSelector('.current-player .action-btn');

    // Click the first action button instead of DND to prove action dispatch works
    console.log("Found action buttons. Clicking first legal action...");
    await page.click('.current-player .action-btn');
    
    await new Promise(r => setTimeout(r, 1000));
    await browser.close();
})();
