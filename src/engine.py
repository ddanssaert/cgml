from typing import Any, Dict, Callable, List, Union, Optional

from loader import EffectAction


def resolve_path(obj: Any, path: str, context: Optional[Dict[str, Any]] = None) -> Any:
    """
    A simple selector resolver supporting a pragmatic subset of the README v1.3 syntax:
    - $.players[0].zones.hand
    - $.zones.deck
    - $.players[*] (returns list of players)
    - $.players[$player] (uses context['$player'])
    Falls back to dot-path access for non-$ roots.
    """
    context = context or {}
    if path is None:
        return obj

    p = path.strip()
    if p.startswith("$"):
        # Build a synthetic root for selector-style paths
        root = {
            "players": getattr(obj, "players", None),
            "zones": getattr(obj, "shared_zones", None),
            "shared_zones": getattr(obj, "shared_zones", None),
            "state": getattr(obj, "current_state", None),
        }
        current: Any = root
        # Tokenize by dots while keeping bracket segments grouped
        parts: List[str] = []
        buf = ""
        i = 1  # skip leading $
        while i < len(p):
            ch = p[i]
            if ch == '.' and ('[' not in buf or (buf.count('[') == buf.count(']'))):
                if buf:
                    parts.append(buf)
                    buf = ""
                i += 1
                continue
            buf += ch
            i += 1
        if buf:
            parts.append(buf)
        # Resolve each part (with optional [index])
        for part in parts:
            key = part
            idx_token: Optional[str] = None
            star = False
            if '[' in part and part.endswith(']'):
                key = part[: part.index('[')]
                inside = part[part.index('[') + 1 : -1]
                if inside == '*':
                    star = True
                else:
                    idx_token = inside
            if key:
                if isinstance(current, list):
                    # map attribute/key over list elements
                    mapped: List[Any] = []
                    for elem in current:
                        if isinstance(elem, dict):
                            mapped.append(elem.get(key))
                        else:
                            mapped.append(getattr(elem, key))
                    current = mapped
                elif isinstance(current, dict):
                    current = current.get(key)
                else:
                    current = getattr(current, key)
            if star:
                # Keep list as-is
                if isinstance(current, dict):
                    current = list(current.values())
                # if scalar, wrap
                if not isinstance(current, list):
                    current = [current]
            elif idx_token is not None:
                # Index can be integer or $player reference
                if idx_token.startswith('$'):
                    if idx_token in context:
                        try:
                            idx = int(context[idx_token])
                        except Exception:
                            idx = context[idx_token]
                    else:
                        raise KeyError(f"Context variable '{idx_token}' not set for path {path}")
                else:
                    try:
                        idx = int(idx_token)
                    except ValueError:
                        idx = idx_token
                if isinstance(current, list):
                    current = current[idx]  # type: ignore[index]
                elif isinstance(current, dict):
                    current = current[idx]  # type: ignore[index]
                else:
                    raise KeyError(f"Cannot index non-collection with [{idx_token}] in path {path}")
        return current

    # Fallback: dotted attribute/dict/list path
    current = obj
    for part in path.split('.'):
        if isinstance(current, dict):
            if part.isdigit() and part in current:
                current = current[part]
            elif part in current:
                current = current[part]
            else:
                try:
                    idx = int(part)
                    current = current[idx]
                except Exception:
                    raise KeyError(f"Key '{part}' not found in dict: {list(current.keys())}")
        elif isinstance(current, list):
            try:
                idx = int(part)
            except ValueError:
                raise KeyError(f"Cannot use key '{part}' on list")
            if idx < len(current):
                current = current[idx]
            else:
                raise IndexError(f"Index '{idx}' out of bounds in list access {repr(path)}")
        elif hasattr(current, part):
            current = getattr(current, part)
        else:
            try:
                current = current[part]
            except Exception:
                raise AttributeError(f"Cannot resolve '{part}' in path '{path}' on {type(current).__name__}")
    return current


def get_rank_index(cgml_definition: Any, deck_type_name: str, rank_value: Any) -> int:
    """Looks up the numeric index of a rank in the deck's rank_hierarchy."""
    if rank_value is None:
        return -1
    rank_hierarchy = cgml_definition.components.component_types['deck_types'][deck_type_name].rank_hierarchy
    try:
        return [str(x) for x in rank_hierarchy].index(str(rank_value))
    except ValueError:
        return -1  # Safe fallback for when comparing an empty zone's top card


from ast_evaluator import evaluate_expression

class RulesEngine:
    """Evaluates conditions and executes effects using an action registry."""

    def __init__(self, action_registry: Dict[str, Callable]):
        self.actions = action_registry

    def _maybe_compare_ranks(self, left: Any, right: Any, game_state: Any) -> (Any, Any):
        """Convert left/right to comparable ordinal if they look like ranks for the game's deck type."""
        cgml_def = getattr(game_state, "cgml_definition", None)
        if cgml_def is None:
            return left, right
        try:
            deck_types = cgml_def.components.component_types.get('deck_types', {})
            if not deck_types:
                return left, right
            deck_type_name = next(iter(deck_types))
            rank_hierarchy = [str(x) for x in deck_types[deck_type_name].rank_hierarchy]
            if str(left) in rank_hierarchy and str(right) in rank_hierarchy:
                left = rank_hierarchy.index(str(left))
                right = rank_hierarchy.index(str(right))
        except Exception:
            pass
        return left, right

    def _op_rank_value(self, arg: Any, game_state: Any, context: Dict[str, Any]) -> int:
        value = self.resolve_operand(arg, game_state, context)
        try:
            if hasattr(value, 'properties') and isinstance(value.properties, dict) and 'rank' in value.properties:
                rank = value.properties['rank']
            elif isinstance(value, dict) and 'properties' in value and 'rank' in value['properties']:
                rank = value['properties']['rank']
            else:
                rank = value
        except Exception:
            rank = value
        cgml_def = getattr(game_state, "cgml_definition", None)
        if cgml_def and cgml_def.components and cgml_def.components.component_types:
            deck_types = cgml_def.components.component_types.get('deck_types', {})
            if deck_types:
                deck_type_name = next(iter(deck_types))
                return get_rank_index(cgml_def, deck_type_name, rank)
        order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
        return order.index(str(rank)) if str(rank) in order else int(rank)

    @staticmethod
    def _count_value(value: Any) -> int:
        """Best-effort counting for zones, lists, strings, and scalars."""
        if value is None:
            return 0
        # Zone-like with cards
        if hasattr(value, 'cards') and isinstance(getattr(value, 'cards'), list):
            return len(getattr(value, 'cards'))
        if hasattr(value, 'card_count'):
            try:
                return int(getattr(value, 'card_count'))
            except Exception:
                pass
        # Collections and strings
        try:
            return len(value)
        except TypeError:
            return 1

    def evaluate_condition(
        self,
        cond: Union[str, Dict, Any],
        game_state: Any,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Executes a string expression condition using ASTEvaluator."""
        context = context or {}
        if not cond:
            return True
        if not isinstance(cond, str):
            # Fallback for old tests or simple booleans
            return bool(cond)
        
        return bool(evaluate_expression(cond, game_state, context, self))

    def resolve_operand(
        self,
        operand: Union[str, Dict, Any],
        game_state: Any,
        context: Optional[Dict[str, Any]] = None
    ) -> Any:
        """Evaluate string arguments to actions (e.g. from='$.zones.deck', count='count($.players[0].hand)')."""
        context = context or {}
        if isinstance(operand, str):
            try:
                # If it's a raw string like "player.current.hand", AST will evaluate it to the object
                return evaluate_expression(operand, game_state, context, self)
            except Exception as e:
                # If AST parsing fails, fallback strings (like literals)
                import logging
                logging.getLogger(__name__).debug(f"Failed to evaluate expression '{operand}': {e}. Falling back to string mode.")
                return operand
        return operand

    def execute_effect(self, effect_list: List[EffectAction], game_state: Any, context: Optional[Dict[str, Any]] = None) -> None:
        """Executes a list of EffectAction models using the action registry. Supports FOR_EACH_PLAYER."""
        context = context or {}
        i = 0
        while i < len(effect_list):
            raw = effect_list[i]
            action_def = EffectAction.parse_obj(raw) if isinstance(raw, dict) else raw
            action_name = action_def.action

            # Special handling: FOR_EACH_PLAYER (either with inline 'do' or affecting next action)
            if action_name == 'FOR_EACH_PLAYER':
                players_operand = getattr(action_def, 'players', None)
                players_list = self.resolve_operand(players_operand, game_state, context) if players_operand else getattr(game_state, 'players', [])
                # Convert to indices
                indices: List[int] = []
                for idx, p in enumerate(getattr(game_state, 'players', [])):
                    if not players_list:
                        indices.append(idx)
                    elif isinstance(players_list, list):
                        if p in players_list or (isinstance(players_list[0], int) and idx in players_list):
                            indices.append(idx)
                do_actions = getattr(action_def, 'do_', None)
                print(f"[DEBUG engine] FOR_EACH_PLAYER matched {len(indices)} players. do_actions is ({len(do_actions) if do_actions else 0}): {do_actions}")
                if isinstance(do_actions, list) and do_actions:
                    for idx in indices:
                        local_ctx = dict(context)
                        local_ctx['$player'] = idx
                        self.execute_effect(do_actions, game_state, context=local_ctx)
                    i += 1
                    continue
                else:
                    # No inline 'do' provided; mark pending to apply to next action
                    context['$foreach_players'] = indices if indices else list(range(len(getattr(game_state, 'players', []))))
                    context['$foreach_pending'] = True
                    i += 1
                    continue

            elif action_name == "FOR_EACH":
                in_val = self.resolve_operand(action_def.dict(by_alias=True).get("in"), game_state, context)
                if not in_val:
                    i += 1
                    continue
                if not isinstance(in_val, list):
                    if hasattr(in_val, "cards"):
                        in_val = in_val.cards
                    else:
                        in_val = [in_val]
                        
                do_actions = getattr(action_def, 'do_', None) or action_def.dict(by_alias=True).get("do")
                if do_actions:
                    for item in in_val:
                        ctx = context.copy()
                        ctx['item'] = item
                        self.execute_effect(do_actions, game_state, ctx)
                i += 1
                continue

            elif action_name == "INCREMENT_VARIABLE":
                path_str = action_def.dict(by_alias=True).get("path")
                val_str = action_def.dict(by_alias=True).get("value", 1)
                
                # evaluate value
                val = evaluate_expression(val_str, game_state, context, self) if isinstance(val_str, str) else val_str
                
                # resolve path
                parts = path_str.split('.')
                target = evaluate_expression('.'.join(parts[:-1]), game_state, context, self)
                if target:
                    attr = parts[-1]
                    if isinstance(target, dict):
                        target[attr] = target.get(attr, 0) + val
                    else:
                        setattr(target, attr, getattr(target, attr, 0) + val)
                i += 1
                continue

            elif action_name == "IF":
                condition = action_def.condition
                do_actions = getattr(action_def, 'do_', None) or action_def.dict(by_alias=True).get("do")
                if self.evaluate_condition(condition, game_state, context):
                    if do_actions:
                        self.execute_effect(do_actions, game_state, context)
                i += 1
                continue

            elif action_name == "FIND_AND_STORE":
                in_val = self.resolve_operand(action_def.dict(by_alias=True).get("in"), game_state, context)
                if not in_val:
                    i += 1
                    continue
                if not isinstance(in_val, list):
                    if hasattr(in_val, "cards"):
                        in_val = in_val.cards
                    else:
                        in_val = [in_val]
                        
                group_by = action_def.dict(by_alias=True).get("group_by")
                having = action_def.dict(by_alias=True).get("having")
                store_as = action_def.dict(by_alias=True).get("store_as")
                if not store_as: 
                    i += 1
                    continue
                
                if group_by:
                    groups = {}
                    for item in in_val:
                        ctx_copy = context.copy()
                        ctx_copy['card'] = item 
                        val = evaluate_expression(group_by, game_state, ctx_copy, self)
                        groups.setdefault(val, []).append(item)
                        
                    result_groups = []
                    for k, v in groups.items():
                        if having:
                            ctx_copy = context.copy()
                            ctx_copy['group'] = v
                            if evaluate_expression(having, game_state, ctx_copy, self):
                                result_groups.append(k)
                        else:
                            result_groups.append(k)
                    context[store_as] = result_groups
                else:
                    context[store_as] = in_val
                i += 1
                continue

            elif action_name == "SET_PROPERTY":
                in_val = self.resolve_operand(action_def.dict(by_alias=True).get("in"), game_state, context)
                if not in_val:
                    i += 1
                    continue
                if not isinstance(in_val, list):
                    if hasattr(in_val, "cards"):
                        in_val = in_val.cards
                    else:
                        in_val = [in_val]
                        
                prop_name = action_def.dict(by_alias=True).get("property")
                prop_val_str = action_def.dict(by_alias=True).get("value")
                prop_val = evaluate_expression(prop_val_str, game_state, context, self) if isinstance(prop_val_str, str) else prop_val_str
                
                if prop_name:
                    for item in in_val:
                        if isinstance(item, dict):
                            item[prop_name] = prop_val
                        else:
                            setattr(item, prop_name, prop_val)
                i += 1
                continue

            elif action_name == "REQUEST_INPUT":
                options = action_def.dict(by_alias=True).get("options") or {}
                store_as = action_def.dict(by_alias=True).get("store_as")
                if options.get("type") == "card_set" and store_as:
                    from_zone = self.resolve_operand(options.get("from"), game_state, context)
                    constraint = options.get("constraint")
                    
                    found_set = []
                    if from_zone and hasattr(from_zone, "cards") and constraint:
                        import itertools
                        cards = from_zone.cards
                        # Try all combinations (largest first is better for Wippen)
                        success = False
                        for r in range(len(cards), 0, -1):
                            for combo in itertools.combinations(cards, r):
                                ctx_copy = context.copy()
                                ctx_copy['group'] = list(combo)
                                try:
                                    if evaluate_expression(constraint, game_state, ctx_copy, self):
                                        found_set = list(combo)
                                        success = True
                                        break
                                except Exception:
                                    pass
                            if success: break
                            
                    context[store_as] = found_set
                    i += 1
                    continue
                # If not a native card_set, fall through to the registry mocked action


            # Normal action execution (with optional foreach-pending fan-out)
            action_func = self.actions.get(action_name) or self.actions.get(action_name.upper())
            if not action_func and action_name == "SET_STATE":
                action_func = self.actions.get("SET_GAME_STATE")

            if action_func:
                if context.get('$foreach_pending') and '$foreach_players' in context:
                    indices = context['$foreach_players']
                    for idx in indices:
                        context['$player'] = idx
                        # Use by_alias=False so keys like 'from_' match function signatures
                        raw_params = action_def.dict(exclude={"action"}, by_alias=False, exclude_none=True)
                        params: Dict[str, Any] = {}
                        for k, v in raw_params.items():
                            if k == "store_as":
                                params[k] = v
                                continue
                            if isinstance(v, (dict, list, str)):
                                params[k] = self.resolve_operand(v, game_state, context)
                            else:
                                params[k] = v
                        action_func(game_state, context=context, **params)
                    # Clear pending fan-out after applying to one action
                    context.pop('$foreach_pending', None)
                    context.pop('$foreach_players', None)
                    context.pop('$player', None)
                else:
                    # Use by_alias=False so keys like 'from_' match function signatures
                    raw_params = action_def.dict(exclude={"action"}, by_alias=False, exclude_none=True)
                    params: Dict[str, Any] = {}
                    for k, v in raw_params.items():
                        if k == "store_as":
                            params[k] = v
                            continue
                        if isinstance(v, (dict, list, str)):
                            params[k] = self.resolve_operand(v, game_state, context)
                        else:
                            params[k] = v
                    action_func(game_state, context=context, **params)
            else:
                print(f"Action not implemented: {action_name}")
            i += 1
