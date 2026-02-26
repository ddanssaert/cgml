"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameSimulator = exports.ACTION_REGISTRY = void 0;
const engine_1 = require("./engine");
const state_1 = require("./state");
const loader_1 = require("./loader");
// Set up logger
const logger = {
    debug: (...args) => { },
    info: (...args) => console.info('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
};
// --- Action Registry Setup ---
function moveAction(gameState, params) {
    const { from_, to, count } = params;
    let cnt = Number(count);
    if (isNaN(cnt))
        cnt = 1;
    if (!from_ || !to)
        return;
    const toZone = to.cards ? to : (0, state_1.findZone)(gameState, to);
    // If from_ is a Card
    if (from_.id && from_.properties) {
        const fromZone = (0, state_1.findCardZone)(gameState, from_);
        if (!fromZone)
            return;
        const idx = fromZone.cards.findIndex(c => c.id === from_.id);
        if (idx !== -1) {
            const card = fromZone.cards.splice(idx, 1)[0];
            toZone.cards.push(card);
        }
        return;
    }
    // Treat as zone
    const fromZone = from_.cards ? from_ : (0, state_1.findZone)(gameState, from_);
    (0, state_1.moveCards)(fromZone, toZone, cnt);
}
function moveAllAction(gameState, params) {
    const { from_, to } = params;
    if (!from_ || !to)
        return;
    const fromZone = from_.cards ? from_ : (0, state_1.findZone)(gameState, from_);
    const toZone = to.cards ? to : (0, state_1.findZone)(gameState, to);
    (0, state_1.moveAllCards)(fromZone, toZone);
}
function setGameStateAction(gameState, params) {
    if (params.state) {
        gameState.current_state = params.state;
    }
}
function shuffleAction(gameState, params) {
    const target = params.target;
    if (!target)
        return;
    const zone = target.cards ? target : (0, state_1.findZone)(gameState, target);
    (0, state_1.shuffleZone)(zone);
}
function drawAction(gameState, params) {
    let { player, count, from_, store_as, context } = params;
    from_ = from_ || "$.zones.deck";
    let cnt = Number(count);
    if (isNaN(cnt))
        cnt = 1;
    const fromZone = typeof from_ === 'string' ? (0, state_1.findZone)(gameState, from_) : from_;
    let p = null;
    if (player === 'current' && context) {
        p = gameState.players[context.$player || 0];
    }
    else if (typeof player === 'object') {
        p = player;
    }
    if (!p)
        return;
    const toZone = p.zones.hand;
    if (fromZone && toZone) {
        const drawn = [];
        const iterCount = Math.min(cnt, fromZone.cards.length);
        for (let i = 0; i < iterCount; i++) {
            const c = fromZone.cards.pop();
            if (c) {
                toZone.cards.push(c);
                drawn.push(c);
            }
        }
        if (store_as && context) {
            context[store_as] = drawn.length === 1 ? drawn[0] : drawn;
        }
    }
}
function requestInputAction(gameState, params) {
    const { player, prompt, options, filter, store_as, context } = params;
    if (context && store_as) {
        if (options && options.type === 'player') {
            const currentIdx = context.$player || 0;
            const opponent = gameState.players.find((_, i) => i !== currentIdx) || gameState.players[gameState.players.length - 1];
            context[store_as] = opponent;
        }
        else if (options && options.type === 'rank') {
            const currentIdx = context.$player || 0;
            const handZone = gameState.players[currentIdx].zones.hand;
            if (handZone && handZone.cards.length > 0) {
                context[store_as] = handZone.cards[0].properties.rank || 'A';
            }
            else {
                context[store_as] = 'A';
            }
        }
        else {
            context[store_as] = "mock_selection";
        }
    }
}
function repeatTurnAction(gameState, params) {
    if (params.context) {
        params.context['$repeat_turn'] = true;
    }
}
exports.ACTION_REGISTRY = {
    "MOVE": moveAction,
    "MOVE_ALL": moveAllAction,
    "SET_GAME_STATE": setGameStateAction,
    "SET_STATE": setGameStateAction,
    "SHUFFLE": shuffleAction,
    "DRAW": drawAction,
    "REQUEST_INPUT": requestInputAction,
    "REPEAT_TURN": repeatTurnAction,
};
class GameSimulator {
    constructor(cgmlDefinition, playerCount) {
        this.currentPlayerIdx = 0;
        this.phaseIdx = 0;
        this.context = {};
        this.cgmlDefinition = cgmlDefinition;
        this.rulesEngine = new engine_1.RulesEngine(exports.ACTION_REGISTRY);
        this.playerCount = playerCount;
        this.gameState = this._initializeState(cgmlDefinition);
        this.flow = cgmlDefinition.flow;
        this.gameState.current_state = this.flow.initial_state;
        this._updateContext();
    }
    _initializeState(cgmlDef) {
        const state = (0, state_1.buildGameStateFromCgml)(cgmlDef, this.playerCount);
        (0, state_1.runSetupPhase)(state);
        return state;
    }
    _updateContext() {
        this.context = {
            '$player': this.currentPlayerIdx,
            'player': {
                'current': this.gameState.players[this.currentPlayerIdx]
            }
        };
    }
    getLegalActions(playerId) {
        const legalActions = [];
        const currentPhase = this._currentPhase();
        for (const rule of this.cgmlDefinition.rules || []) {
            if (rule.trigger === `on.phase.${currentPhase}`) {
                if (!rule.condition || this.rulesEngine.evaluateCondition(rule.condition, this.gameState, this.context)) {
                    if (rule.effect) {
                        legalActions.push({
                            rule_id: rule.id,
                            effect: rule.effect
                        });
                    }
                }
            }
        }
        return legalActions;
    }
    _getPhasesForState(stateName) {
        if (!stateName)
            return [];
        const stateDef = this.flow.states[stateName];
        return stateDef && stateDef.phases ? stateDef.phases : [];
    }
    _currentPhase() {
        const phases = this._getPhasesForState(this.gameState.current_state);
        if (this.phaseIdx >= 0 && this.phaseIdx < phases.length) {
            return phases[this.phaseIdx];
        }
        return null;
    }
    _checkStateTransitions() {
        const transitions = this.flow.transitions || [];
        for (const t of transitions) {
            if (this.gameState.current_state !== t.from)
                continue;
            if (!t.condition || this.rulesEngine.evaluateCondition(t.condition, this.gameState, this.context)) {
                this.gameState.current_state = t.to;
                this.phaseIdx = 0;
                return true;
            }
        }
        return false;
    }
    run() {
        while (true) {
            logger.debug(`Sim state: ${this.gameState.current_state}, phase: ${this._currentPhase()}, player: ${this.currentPlayerIdx}`);
            const cardCounts = [
                ...Object.values(this.gameState.shared_zones).map(z => `${z.name}: ${z.cards.length}`),
                ...this.gameState.players.flatMap(p => Object.values(p.zones).map(z => `${p.name} ${z.name}: ${z.cards.length}`))
            ].join(',\t');
            logger.info(`Zone card counts: ${cardCounts}`);
            if (this._isGameOver()) {
                console.log("Game over!");
                break;
            }
            const playerId = this.currentPlayerIdx;
            const legal = this.getLegalActions(playerId);
            if (legal.length === 0) {
                if (this._checkStateTransitions()) {
                    if (this._isGameOver()) {
                        console.log("Game over!");
                        break;
                    }
                    continue;
                }
                if (!this._advancePhase()) {
                    if (this._getPhasesForState(this.gameState.current_state).length === 0) {
                        break;
                    }
                }
                continue;
            }
            const prevStateName = this.gameState.current_state;
            const selectedAction = legal[Math.floor(Math.random() * legal.length)];
            this.rulesEngine.executeEffect(selectedAction.effect, this.gameState, this.context);
            if (this.context['$repeat_turn']) {
                this.context['$repeat_turn'] = false;
                this.phaseIdx = 0;
                continue;
            }
            if (this.gameState.current_state !== prevStateName) {
                this.phaseIdx = 0;
                continue;
            }
            if (this._checkStateTransitions()) {
                if (this._isGameOver()) {
                    console.log("Game over!");
                    break;
                }
                continue;
            }
            this._advancePhase();
        }
    }
    _isGameOver() {
        return this.gameState.current_state === "GameOver";
    }
    _advanceTurn() {
        const numPlayers = this.gameState.players.length;
        this.currentPlayerIdx = (this.currentPlayerIdx + 1) % numPlayers;
        this._updateContext();
    }
    _advancePhase() {
        const phases = this._getPhasesForState(this.gameState.current_state);
        if (!phases || phases.length === 0)
            return false;
        this.phaseIdx++;
        if (this.phaseIdx >= phases.length) {
            this.phaseIdx = 0;
            this._advanceTurn();
            return false;
        }
        return true;
    }
}
exports.GameSimulator = GameSimulator;
// CLI Execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const gameFile = args[0] || "../wippen.yml";
    const cgml = (0, loader_1.loadCgmlFile)(gameFile);
    const simulator = new GameSimulator(cgml, 2);
    simulator.run();
}
