"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RulesEngine = void 0;
exports.resolvePath = resolvePath;
exports.getRankIndex = getRankIndex;
const ast_evaluator_1 = require("./ast_evaluator");
const state_1 = require("./state");
function resolvePath(obj, pathStr, context) {
    const ctx = context || {};
    if (!pathStr)
        return obj;
    const p = pathStr.trim();
    if (p.startsWith("$")) {
        let current = {
            players: obj.players,
            zones: obj.shared_zones,
            shared_zones: obj.shared_zones,
            state: obj.current_state,
        };
        const parts = [];
        let buf = "";
        let i = 1;
        while (i < p.length) {
            const ch = p[i];
            if (ch === '.' && (!buf.includes('[') || (buf.match(/\[/g)?.length === buf.match(/\]/g)?.length))) {
                if (buf) {
                    parts.push(buf);
                    buf = "";
                }
                i++;
                continue;
            }
            buf += ch;
            i++;
        }
        if (buf)
            parts.push(buf);
        for (const part of parts) {
            let key = part;
            let idxToken = null;
            let star = false;
            if (part.includes('[') && part.endsWith(']')) {
                key = part.substring(0, part.indexOf('['));
                const inside = part.substring(part.indexOf('[') + 1, part.length - 1);
                if (inside === '*')
                    star = true;
                else
                    idxToken = inside;
            }
            if (key) {
                if (Array.isArray(current)) {
                    current = current.map(elem => typeof elem === 'object' && elem !== null && key in elem ? elem[key] : elem[key]);
                }
                else if (typeof current === 'object' && current !== null) {
                    current = current[key];
                }
            }
            if (star) {
                if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
                    current = Object.values(current);
                }
                if (!Array.isArray(current))
                    current = [current];
            }
            else if (idxToken !== null) {
                let idx;
                if (idxToken.startsWith('$')) {
                    if (idxToken in ctx)
                        idx = Number(ctx[idxToken]) >= 0 ? Number(ctx[idxToken]) : ctx[idxToken];
                    else
                        throw new Error(`Context variable '${idxToken}' not set for path ${pathStr}`);
                }
                else {
                    idx = isNaN(Number(idxToken)) ? idxToken : Number(idxToken);
                }
                if (Array.isArray(current) || (typeof current === 'object' && current !== null)) {
                    current = current[idx];
                }
                else {
                    throw new Error(`Cannot index non-collection with [${idxToken}] in path ${pathStr}`);
                }
            }
        }
        return current;
    }
    // Fallback: dotted attribute/dict/list path
    let current = obj;
    for (const part of pathStr.split('.')) {
        if (current === undefined || current === null)
            throw new Error(`Path resolution failed at part ${part} of ${pathStr}`);
        if (Array.isArray(current)) {
            const idx = Number(part);
            if (!isNaN(idx))
                current = current[idx];
            else
                throw new Error(`Cannot use key '${part}' on list`);
        }
        else if (typeof current === 'object') {
            current = current[part];
        }
        else {
            throw new Error(`Cannot resolve '${part}' in path '${pathStr}'`);
        }
    }
    return current;
}
function getRankIndex(cgmlDef, deckTypeName, rankValue) {
    if (rankValue === null || rankValue === undefined)
        return -1;
    try {
        const hierarchy = cgmlDef.components.component_types.deck_types[deckTypeName].rank_hierarchy;
        const strHierarchy = hierarchy.map((x) => String(x));
        return strHierarchy.indexOf(String(rankValue));
    }
    catch {
        return -1;
    }
}
class RulesEngine {
    constructor(actions) {
        this.actions = actions;
    }
    resolvePath(obj, pathStr, context) {
        return resolvePath(obj, pathStr, context);
    }
    _maybeCompareRanks(left, right, gameState) {
        const cgmlDef = gameState.cgml_definition;
        if (!cgmlDef || !cgmlDef.components?.component_types?.deck_types)
            return [left, right];
        const deckTypes = cgmlDef.components.component_types.deck_types;
        const deckTypeName = Object.keys(deckTypes)[0];
        if (!deckTypeName)
            return [left, right];
        const hierarchy = deckTypes[deckTypeName].rank_hierarchy.map((x) => String(x));
        if (hierarchy.includes(String(left)) && hierarchy.includes(String(right))) {
            return [hierarchy.indexOf(String(left)), hierarchy.indexOf(String(right))];
        }
        return [left, right];
    }
    opRankValue(arg, gameState, context) {
        const value = this.resolveOperand(arg, gameState, context);
        let rank = value;
        try {
            if (value && value.properties && 'rank' in value.properties) {
                rank = value.properties.rank;
            }
        }
        catch { }
        const cgmlDef = gameState.cgml_definition;
        if (cgmlDef?.components?.component_types?.deck_types) {
            const deckTypeName = Object.keys(cgmlDef.components.component_types.deck_types)[0];
            if (deckTypeName) {
                return getRankIndex(cgmlDef, deckTypeName, rank);
            }
        }
        const order = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        return order.includes(String(rank)) ? order.indexOf(String(rank)) : Number(rank);
    }
    _countValue(value) {
        if (value === null || value === undefined)
            return 0;
        if (value instanceof state_1.Zone)
            return value.cardCount;
        if (Array.isArray(value))
            return value.length;
        if (typeof value === 'object' && 'cards' in value && Array.isArray(value.cards))
            return value.cards.length;
        if (typeof value === 'string' || typeof value === 'object')
            return Object.keys(value).length;
        return 1;
    }
    evaluateCondition(cond, gameState, context) {
        const ctx = context || {};
        if (!cond)
            return true;
        if (typeof cond !== 'string')
            return !!cond;
        return !!(0, ast_evaluator_1.evaluateExpression)(cond, gameState, ctx, this);
    }
    resolveOperand(operand, gameState, context) {
        const ctx = context || {};
        if (typeof operand === 'string') {
            try {
                return (0, ast_evaluator_1.evaluateExpression)(operand, gameState, ctx, this);
            }
            catch (e) {
                // fallback to string literal
                return operand;
            }
        }
        return operand;
    }
    executeEffect(effectList, gameState, context) {
        const ctx = context || {};
        let i = 0;
        while (i < effectList.length) {
            const actionDef = effectList[i];
            const actionName = actionDef.action;
            if (actionName === 'FOR_EACH_PLAYER') {
                const playersOperand = actionDef.players;
                const playersList = playersOperand ? this.resolveOperand(playersOperand, gameState, ctx) : gameState.players;
                const indices = [];
                for (let idx = 0; idx < gameState.players.length; idx++) {
                    const p = gameState.players[idx];
                    if (!playersList) {
                        indices.push(idx);
                    }
                    else if (Array.isArray(playersList)) {
                        if (playersList.includes(p) || playersList.includes(idx)) {
                            indices.push(idx);
                        }
                    }
                }
                const doActions = actionDef.do || actionDef.do_;
                if (doActions && Array.isArray(doActions) && doActions.length > 0) {
                    for (const idx of indices) {
                        const localCtx = { ...ctx, $player: idx, "player.current": gameState.players[idx] };
                        this.executeEffect(doActions, gameState, localCtx);
                    }
                    i++;
                    continue;
                }
                else {
                    ctx['$foreach_players'] = indices.length > 0 ? indices : gameState.players.map((_, idx) => idx);
                    ctx['$foreach_pending'] = true;
                    i++;
                    continue;
                }
            }
            else if (actionName === "FOR_EACH") {
                let inVal = this.resolveOperand(actionDef.in, gameState, ctx);
                if (!inVal) {
                    i++;
                    continue;
                }
                if (!Array.isArray(inVal)) {
                    if (inVal instanceof state_1.Zone || (inVal.cards && Array.isArray(inVal.cards))) {
                        inVal = inVal.cards;
                    }
                    else {
                        inVal = [inVal];
                    }
                }
                const doActions = actionDef.do || actionDef.do_;
                if (doActions) {
                    for (const item of inVal) {
                        const localCtx = { ...ctx, item };
                        this.executeEffect(doActions, gameState, localCtx);
                    }
                }
                i++;
                continue;
            }
            else if (actionName === "INCREMENT_VARIABLE") {
                const pathStr = actionDef.path;
                const valStr = actionDef.value !== undefined ? actionDef.value : 1;
                const val = typeof valStr === 'string' ? (0, ast_evaluator_1.evaluateExpression)(valStr, gameState, ctx, this) : valStr;
                const parts = String(pathStr).split('.');
                const targetPath = parts.slice(0, -1).join('.');
                const target = (0, ast_evaluator_1.evaluateExpression)(targetPath, gameState, ctx, this);
                if (target) {
                    const attr = parts[parts.length - 1];
                    target[attr] = (Number(target[attr]) || 0) + Number(val);
                }
                i++;
                continue;
            }
            else if (actionName === "IF") {
                if (this.evaluateCondition(actionDef.condition, gameState, ctx)) {
                    const doActions = actionDef.do || actionDef.do_ || actionDef.then;
                    if (doActions)
                        this.executeEffect(doActions, gameState, ctx);
                }
                else {
                    const elseActions = actionDef.else;
                    if (elseActions)
                        this.executeEffect(elseActions, gameState, ctx);
                }
                i++;
                continue;
            }
            else if (actionName === "FIND_AND_STORE") {
                let inVal = this.resolveOperand(actionDef.in, gameState, ctx);
                if (!inVal) {
                    i++;
                    continue;
                }
                if (!Array.isArray(inVal)) {
                    inVal = inVal.cards || [inVal];
                }
                const groupBy = actionDef.group_by;
                const having = actionDef.having;
                const storeAs = actionDef.store_as;
                if (!storeAs) {
                    i++;
                    continue;
                }
                if (groupBy) {
                    const groups = {};
                    for (const item of inVal) {
                        const subCtx = { ...ctx, card: item };
                        const val = (0, ast_evaluator_1.evaluateExpression)(groupBy, gameState, subCtx, this);
                        if (!groups[val])
                            groups[val] = [];
                        groups[val].push(item);
                    }
                    const resultGroups = [];
                    for (const [k, v] of Object.entries(groups)) {
                        if (having) {
                            const subCtx = { ...ctx, group: v };
                            if ((0, ast_evaluator_1.evaluateExpression)(having, gameState, subCtx, this))
                                resultGroups.push(k);
                        }
                        else {
                            resultGroups.push(k);
                        }
                    }
                    ctx[storeAs] = resultGroups;
                }
                else {
                    const filter = actionDef.filter;
                    if (filter) {
                        ctx[storeAs] = inVal.filter((item) => (0, ast_evaluator_1.evaluateExpression)(filter, gameState, { ...ctx, card: item }, this));
                    }
                    else {
                        ctx[storeAs] = inVal;
                    }
                }
                i++;
                continue;
            }
            else if (actionName === "SET_PROPERTY") {
                let inVal = this.resolveOperand(actionDef.in, gameState, ctx);
                if (!inVal) {
                    i++;
                    continue;
                }
                if (!Array.isArray(inVal))
                    inVal = inVal.cards || [inVal];
                const propName = actionDef.property;
                const propValStr = actionDef.value;
                const propVal = typeof propValStr === 'string' ? (0, ast_evaluator_1.evaluateExpression)(propValStr, gameState, ctx, this) : propValStr;
                if (propName) {
                    for (const item of inVal) {
                        item[propName] = propVal;
                    }
                }
                i++;
                continue;
            }
            else if (actionName === "REQUEST_INPUT") {
                const options = actionDef.options || {};
                const storeAs = actionDef.store_as;
                if (options.type === "card_set" && storeAs) {
                    const fromZone = this.resolveOperand(options.from, gameState, ctx);
                    const constraint = options.constraint;
                    let foundSet = [];
                    if (fromZone && fromZone.cards && constraint) {
                        // Very naive brute force search for any valid combo
                        const cards = fromZone.cards;
                        let success = false;
                        // Try all non-empty subsets (power set) starting from largest
                        // In JS this is messy, we'll do a simple recursive subset generator
                        const subsets = (arr) => arr.reduce((sub, value) => sub.concat(sub.map(set => [value, ...set])), [[]]);
                        const allSubsets = subsets(cards).filter(s => s.length > 0).sort((a, b) => b.length - a.length);
                        for (const combo of allSubsets) {
                            const subCtx = { ...ctx, group: combo };
                            try {
                                if ((0, ast_evaluator_1.evaluateExpression)(constraint, gameState, subCtx, this)) {
                                    foundSet = combo;
                                    success = true;
                                    break;
                                }
                            }
                            catch { }
                        }
                    }
                    ctx[storeAs] = foundSet;
                    i++;
                    continue;
                }
            }
            // Normal action lookup
            let actionFunc = this.actions[actionName] || this.actions[actionName.toUpperCase()];
            if (!actionFunc && actionName === "SET_STATE")
                actionFunc = this.actions["SET_GAME_STATE"];
            if (actionFunc) {
                if (ctx['$foreach_pending'] && ctx['$foreach_players']) {
                    const indices = ctx['$foreach_players'];
                    for (const idx of indices) {
                        ctx['$player'] = idx;
                        const params = {};
                        for (const [k, v] of Object.entries(actionDef)) {
                            if (k === 'action' || k === 'store_as' || k === 'from_')
                                continue;
                            const key = k === 'from' ? 'from_' : k;
                            if (typeof v === 'string' || Array.isArray(v) || (typeof v === 'object' && v !== null)) {
                                params[key] = this.resolveOperand(v, gameState, ctx);
                            }
                            else {
                                params[key] = v;
                            }
                        }
                        if (actionDef.store_as)
                            params['store_as'] = actionDef.store_as;
                        if (actionDef.from_)
                            params['from_'] = this.resolveOperand(actionDef.from_, gameState, ctx);
                        actionFunc(gameState, { context: ctx, ...params });
                    }
                    delete ctx['$foreach_pending'];
                    delete ctx['$foreach_players'];
                    delete ctx['$player'];
                }
                else {
                    const params = {};
                    for (const [k, v] of Object.entries(actionDef)) {
                        if (k === 'action' || k === 'store_as' || k === 'from_')
                            continue;
                        const key = k === 'from' ? 'from_' : k;
                        if (typeof v === 'string' || Array.isArray(v) || (typeof v === 'object' && v !== null)) {
                            params[key] = this.resolveOperand(v, gameState, ctx);
                        }
                        else {
                            params[key] = v;
                        }
                    }
                    if (actionDef.store_as)
                        params['store_as'] = actionDef.store_as;
                    if (actionDef.from_)
                        params['from_'] = this.resolveOperand(actionDef.from_, gameState, ctx);
                    actionFunc(gameState, { context: ctx, ...params });
                }
            }
            else {
                console.warn(`Action not implemented: ${actionName}`);
            }
            i++;
        }
    }
}
exports.RulesEngine = RulesEngine;
