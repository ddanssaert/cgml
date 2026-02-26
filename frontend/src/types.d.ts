declare module 'cgml-engine/src/simulator' {
    export class GameSimulator {
        constructor(parsedDef: any, playerCount: number);
        gameState: any;
        currentPlayerIdx: number;
        phaseIdx: number;
        context: Record<string, any>;
        rulesEngine: any;
        flow: any;
        playerCount: number;
        getLegalActions(playerIdx: number): any[];
    }
}
declare module 'cgml-engine/src/loader' {
    export function loadCgmlFile(filepath: string): any;
}
declare module 'cgml-engine/src/state' {
    export class GameState {
        current_state: string;
        players: Player[];
        shared_zones: Record<string, Zone>;
    }
    export class Player {
        name: string;
        zones: Record<string, Zone>;
    }
    export class Zone {
        name: string;
        id?: string;
        cards: Card[];
    }
    export class Card {
        id: string;
        properties: Record<string, any>;
    }
}
