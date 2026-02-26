import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.goto('http://localhost:5175', { waitUntil: 'networkidle0' });
    
    // Start game
    await page.click('.load-btn');
    await page.waitForSelector('.game-board');

    // Wait for cards to appear in hand
    await page.waitForSelector('.current-player .card-wrapper');
    
    const handCard = await page.$('.current-player .card-wrapper');
    const tableZone = await page.$('.table-area .zone');

    if (handCard && tableZone) {
        console.log("Found card and table logic. Dragging...");
        
        // Puppeteer drag and drop is tricky, simpler to emit events or use coordinate drag
        const cardBox = await handCard.boundingBox();
        const tableBox = await tableZone.boundingBox();

        await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2, { steps: 10 });
        await page.mouse.up();
        
        // Wait a bit for React to process
        await new Promise(r => setTimeout(r, 1000));
    } else {
        console.log("Could not find card or table zone.");
    }

    await browser.close();
})();
