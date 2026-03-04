"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = exports.Player = exports.Zone = exports.Card = void 0;
exports.createDeck = createDeck;
exports.buildGameStateFromCgml = buildGameStateFromCgml;
exports.findZone = findZone;
exports.shuffleZone = shuffleZone;
exports.moveCards = moveCards;
exports.moveAllCards = moveAllCards;
exports.dealCards = dealCards;
exports.dealAllCards = dealAllCards;
exports.findCardZone = findCardZone;
exports.performSetupAction = performSetupAction;
exports.runSetupPhase = runSetupPhase;
class Card {
    constructor(id, name, properties, owner = null) {
        this.owner = null; // player id if applicable
        this.id = id;
        this.name = name;
        this.properties = properties;
        this.owner = owner;
    }
}
exports.Card = Card;
class Zone {
    constructor(name, type, of_deck = null, owner = null, layout = 'stack') {
        this.of_deck = null;
        this.owner = null; // player id or null for shared
        this.ordering = null;
        this.visibility = null;
        this.cards = [];
        this.name = name;
        this.type = type;
        this.of_deck = of_deck;
        this.owner = owner;
        this.layout = layout;
    }
    get cardCount() {
        return this.cards.length;
    }
    get topCard() {
        if (this.cards.length === 0)
            return null;
        return this.cards[this.cards.length - 1];
    }
}
exports.Zone = Zone;
class Player {
    constructor(id, name) {
        this.variables = {};
        this.zones = {};
        this.id = id;
        this.name = name;
    }
}
exports.Player = Player;
class GameState {
    constructor(init) {
        this.players = [];
        this.shared_zones = {};
        this.shared_variables = {};
        this.decks = {};
        this.cgml_definition = null;
        this.current_state = null;
        if (init)
            Object.assign(this, init);
    }
}
exports.GameState = GameState;
function createDeck(deckDef, deckTypeDef) {
    const cards = [];
    const comp = deckTypeDef.composition || [];
    let idx = 0;
    for (const entry of comp) {
        if (entry.type === "template" && entry.template === "standard_suits") {
            const ranks = entry.values;
            const suits = ["♠", "♥", "♦", "♣"];
            for (const suit of suits) {
                for (const rank of ranks) {
                    idx++;
                    const cardId = `${deckDef.type}-${suit}-${rank}-${idx}`;
                    const cardName = `${rank}${suit}`;
                    cards.push(new Card(cardId, cardName, { rank, suit }));
                }
            }
        }
    }
    return cards;
}
function buildGameStateFromCgml(cgml, playerCountOverride) {
    const deckTypes = cgml.components?.component_types?.deck_types || {};
    const decks = {};
    const rawDecks = cgml.decks || cgml.components?.decks || {};
    for (const [deckName, deckDef] of Object.entries(rawDecks)) {
        const deckTypeDef = deckTypes[deckDef.type] || {};
        decks[deckName] = createDeck(deckDef, deckTypeDef);
    }
    const playerCount = playerCountOverride || cgml.meta.players.max;
    const players = [];
    const varDefs = cgml.variables || cgml.components?.variables || [];
    const perPlayerVars = {};
    const sharedVars = {};
    for (const v of varDefs) {
        if (v.per_player)
            perPlayerVars[v.name] = v.initial_value;
        else
            sharedVars[v.name] = v.initial_value;
    }
    const zoneDefs = cgml.zones || cgml.components?.zones || [];
    const sharedZones = {};
    const perPlayerZoneDefs = zoneDefs.filter((z) => z.per_player);
    const sharedZoneDefs = zoneDefs.filter((z) => !z.per_player);
    const zoneTypes = cgml.components?.component_types?.zone_types || cgml.component_types?.zone_types || {};
    for (let pidx = 0; pidx < playerCount; pidx++) {
        const pname = `Player ${pidx + 1}`;
        const player = new Player(pidx, pname);
        player.variables = { ...perPlayerVars };
        for (const zoneDef of perPlayerZoneDefs) {
            const zLayout = zoneTypes[zoneDef.type]?.layout || 'stack';
            const zone = new Zone(zoneDef.name, zoneDef.type, zoneDef.of_deck || null, pidx, zLayout);
            player.zones[zone.name] = zone;
        }
        players.push(player);
    }
    for (const zoneDef of sharedZoneDefs) {
        const zLayout = zoneTypes[zoneDef.type]?.layout || 'stack';
        sharedZones[zoneDef.name] = new Zone(zoneDef.name, zoneDef.type, zoneDef.of_deck || null, null, zLayout);
    }
    const state = new GameState({
        players,
        shared_zones: sharedZones,
        shared_variables: sharedVars,
        decks,
        cgml_definition: cgml,
    });
    // Assign cards from deck
    for (const [deckName, cards] of Object.entries(decks)) {
        let assigned = false;
        for (const zone of Object.values(state.shared_zones)) {
            if (zone.of_deck === deckName) {
                zone.cards.push(...cards);
                assigned = true;
            }
        }
        for (const player of state.players) {
            for (const zone of Object.values(player.zones)) {
                if (zone.of_deck === deckName) {
                    zone.cards.push(...cards);
                    assigned = true;
                }
            }
        }
        if (!assigned) {
            console.warn(`Warning: Deck '${deckName}' was generated but not assigned to any zone!`);
        }
    }
    return state;
}
function findZone(state, zonePath, playerContext) {
    if (zonePath instanceof Zone)
        return zonePath;
    // Shortcut
    if (!zonePath.includes('.') && !zonePath.includes('[')) {
        if (playerContext && playerContext.zones[zonePath])
            return playerContext.zones[zonePath];
        if (state.shared_zones[zonePath])
            return state.shared_zones[zonePath];
        for (const p of state.players) {
            if (p.zones[zonePath])
                return p.zones[zonePath];
        }
        throw new Error(`Zone '${zonePath}' not found.`);
    }
    // JSONPath-like start
    if (zonePath.startsWith('$.')) {
        let current = {
            players: state.players,
            zones: state.shared_zones,
            shared_zones: state.shared_zones,
        };
        const parts = [];
        let buf = '';
        for (let i = 2; i < zonePath.length; i++) {
            const ch = zonePath[i];
            if (ch === '.' && !buf.includes('[') && !buf.includes(']')) {
                if (buf) {
                    parts.push(buf);
                    buf = '';
                }
                continue;
            }
            buf += ch;
        }
        if (buf)
            parts.push(buf);
        for (const part of parts) {
            let key = part;
            let idx = null;
            if (part.includes('[') && part.endsWith(']')) {
                key = part.substring(0, part.indexOf('['));
                const inside = part.substring(part.indexOf('[') + 1, part.length - 1);
                if (inside !== '*')
                    idx = parseInt(inside, 10);
            }
            if (key) {
                current = current[key];
            }
            if (idx !== null) {
                current = current[idx];
            }
        }
        const isObj = current && typeof current === 'object';
        const hasCardsArr = isObj && Array.isArray(current.cards);
        if (isObj && hasCardsArr)
            return current;
        console.error("findZone duck typing failed! isObj:", isObj, "hasCardsArr:", hasCardsArr, "current.cards type:", isObj ? typeof current.cards : 'N/A', "is Array?", isObj ? Array.isArray(current.cards) : false);
        console.error("findZone failed! current:", current, "Is array?", Array.isArray(current), "Keys?", current ? Object.keys(current) : "null");
        console.error("state.shared_zones:", Object.keys(state.shared_zones));
        throw new Error(`Path '${zonePath}' does not resolve to a Zone`);
    }
    // Dotted paths context
    const ctx = {
        players: state.players,
        zones: state.shared_zones,
        shared_zones: state.shared_zones,
    };
    if (playerContext)
        ctx.player = playerContext;
    let current = ctx;
    for (const part of zonePath.split('.')) {
        if (Array.isArray(current)) {
            const idx = parseInt(part, 10);
            current = current[idx];
        }
        else if (typeof current === 'object' && current !== null) {
            current = current[part];
        }
        else {
            throw new Error(`Cannot resolve part '${part}'`);
        }
    }
    if (!(current instanceof Zone)) {
        throw new Error(`Path '${zonePath}' does not resolve to a Zone`);
    }
    return current;
}
function shuffleZone(zone) {
    for (let i = zone.cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [zone.cards[i], zone.cards[j]] = [zone.cards[j], zone.cards[i]];
    }
}
function moveCards(fromZone, toZone, count = 1) {
    const amount = Math.min(count, fromZone.cards.length);
    for (let i = 0; i < amount; i++) {
        toZone.cards.push(fromZone.cards.pop());
    }
}
function moveAllCards(fromZone, toZone) {
    while (fromZone.cards.length > 0) {
        toZone.cards.push(fromZone.cards.pop());
    }
}
function dealCards(fromZone, players, toZoneName, count) {
    for (let i = 0; i < count; i++) {
        for (const player of players) {
            if (fromZone.cards.length > 0) {
                player.zones[toZoneName].cards.push(fromZone.cards.pop());
            }
        }
    }
}
function dealAllCards(fromDeck, players, toZoneName) {
    let idx = 0;
    const plCount = players.length;
    while (fromDeck.cards.length > 0) {
        const player = players[idx % plCount];
        player.zones[toZoneName].cards.push(fromDeck.cards.pop());
        idx++;
    }
}
function findCardZone(state, card) {
    for (const zone of Object.values(state.shared_zones)) {
        for (const c of zone.cards) {
            if (c.id === card.id)
                return zone;
        }
    }
    for (const p of state.players) {
        for (const zone of Object.values(p.zones)) {
            for (const c of zone.cards) {
                if (c.id === card.id)
                    return zone;
            }
        }
    }
    return null;
}
function performSetupAction(action, state) {
    const typ = action.action;
    if (typ === "SHUFFLE") {
        let target = action.target;
        if (typeof target === 'object' && target.path)
            target = target.path;
        if (typeof target === 'string') {
            if (target.startsWith("zones.")) {
                const name = target.split('.')[1];
                if (state.shared_zones[name])
                    shuffleZone(state.shared_zones[name]);
            }
            else {
                shuffleZone(findZone(state, target));
            }
        }
    }
    else if (typ === "DEAL") {
        const fromPath = typeof action.from === 'object' ? action.from.path : action.from;
        const toPath = typeof action.to === 'object' ? action.to.path : action.to;
        const count = action.count || 1;
        const fromZone = findZone(state, fromPath);
        const toZoneName = toPath.split('.').pop();
        dealCards(fromZone, state.players, toZoneName, count);
    }
    else if (typ === "MOVE") {
        const fromPath = typeof action.from === 'object' ? action.from.path : action.from;
        const toPath = typeof action.to === 'object' ? action.to.path : action.to;
        const count = action.count || 1;
        moveCards(findZone(state, fromPath), findZone(state, toPath), count);
    }
    else if (typ === "MOVE_ALL") {
        const fromPath = typeof action.from === 'object' ? action.from.path : action.from;
        const toPath = typeof action.to === 'object' ? action.to.path : action.to;
        moveAllCards(findZone(state, fromPath), findZone(state, toPath));
    }
    else if (typ === "DEAL_ALL") {
        const fromPath = typeof action.from === 'object' ? action.from.path : action.from;
        const toPath = typeof action.to === 'object' ? action.to.path : action.to;
        const deckZone = findZone(state, fromPath);
        const toZoneName = toPath.split('.').pop();
        dealAllCards(deckZone, state.players, toZoneName);
    }
    else {
        throw new Error(`Unknown setup action: ${typ}`);
    }
}
function runSetupPhase(state) {
    for (const action of state.cgml_definition.setup || []) {
        performSetupAction(action, state);
    }
}
