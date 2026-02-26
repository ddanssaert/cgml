import { loadCgmlFile } from './src/loader';
import { buildGameStateFromCgml, runSetupPhase } from './src/state';
import * as path from 'path';

const file = process.argv[2] || '../games/wippen.yml';
const fullPath = path.resolve(__dirname, file);

try {
    const cgml = loadCgmlFile(fullPath);
    if (cgml) {
        console.log("Successfully loaded CGML:", cgml.meta.name);
        const state = buildGameStateFromCgml(cgml);
        console.log(`Initialized with ${state.players.length} players and ${Object.keys(state.decks).length} decks.`);
        runSetupPhase(state);
        console.log(`Setup complete. Top of player 1 hand:`, state.players[0].zones.hand.topCard?.name);
    } else {
        console.error("Failed to load CGML.");
        process.exit(1);
    }
} catch (e) {
    console.error("Exception loading CGML:", e);
    process.exit(1);
}
