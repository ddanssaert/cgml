"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const loader_1 = require("./src/loader");
const state_1 = require("./src/state");
const path = __importStar(require("path"));
const file = process.argv[2] || '../games/wippen.yml';
const fullPath = path.resolve(__dirname, file);
try {
    const cgml = (0, loader_1.loadCgmlFile)(fullPath);
    if (cgml) {
        console.log("Successfully loaded CGML:", cgml.meta.name);
        const state = (0, state_1.buildGameStateFromCgml)(cgml);
        console.log(`Initialized with ${state.players.length} players and ${Object.keys(state.decks).length} decks.`);
        (0, state_1.runSetupPhase)(state);
        console.log(`Setup complete. Top of player 1 hand:`, state.players[0].zones.hand.topCard?.name);
    }
    else {
        console.error("Failed to load CGML.");
        process.exit(1);
    }
}
catch (e) {
    console.error("Exception loading CGML:", e);
    process.exit(1);
}
