import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { GameSimulator } from './src/simulator';

const yml = fs.readFileSync('../games/high_card.yml', 'utf8');
const doc = yaml.load(yml);
const sim = new GameSimulator(doc as any, 2);
console.log("DECK SIZE:", sim.gameState.shared_zones.deck.cards.length);
console.log("PLAYER 1 DECK SIZE:", sim.gameState.players[0].zones.player_deck.cards.length);
