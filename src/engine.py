from typing import Any, Dict, Callable, List, Union, Optional
import operator

def resolve_path(obj: Any, path: str) -> Any:
    """
    A simple dot-path resolver. Example: "player.0.zones.play_area.top_card.rank"
    Handles lists/objects and falls back to dict access.
    """
    if path is None:
        return obj

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
                    # Index into dict via int, if keys are ints
                    current = current[idx]
                except:
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
            # Try to fall back to dict as last resort
            try:
                current = current[part]
            except Exception:
                raise AttributeError(f"Cannot resolve '{part}' in path '{path}' on {repr(current)}")
    return current

class RulesEngine:
    def __init__(self, action_registry: Dict[str, Callable]):
        """
        :param action_registry: Mapping action_name => callable(game_state, **params)
        """
        self.actions = action_registry

    def evaluate_condition(self, cond: Union[Dict, Any], game_state: Any, context: Dict[str, Any]=None) -> bool:
        """Recursively evaluate a structured condition node."""
        context = context or {}

        if not isinstance(cond, dict):
            return bool(cond)

        for key, value in cond.items():
            if key == "isEqual":
                left_val = self.resolve_operand(value[0], game_state, context)
                right_val = self.resolve_operand(value[1], game_state, context)
                return left_val == right_val
            elif key == "isGreaterThan":
                left_val = self.resolve_operand(value[0], game_state, context)
                right_val = self.resolve_operand(value[1], game_state, context)
                return left_val > right_val
            elif key == "isLessThan":
                left_val = self.resolve_operand(value[0], game_state, context)
                right_val = self.resolve_operand(value[1], game_state, context)
                return left_val < right_val
            elif key == "and":
                return all(self.evaluate_condition(sub, game_state, context) for sub in value)
            elif key == "or":
                return any(self.evaluate_condition(sub, game_state, context) for sub in value)
            elif key == "not":
                return not self.evaluate_condition(value, game_state, context)
            elif key == "max":
                # Value is list of operands (often a path for each player)
                vals = [self.resolve_operand(x, game_state, context) for x in value]
                return max(vals)
            elif key == "min":
                vals = [self.resolve_operand(x, game_state, context) for x in value]
                return min(vals)
            elif key == "count":
                # Value is usually a collection or a filter
                collection = value
                if isinstance(collection, list) and len(collection) == 1:
                    # If a filter node, evaluate recursively
                    return len(self.resolve_operand(collection[0], game_state, context))
                elif isinstance(collection, (list, tuple)):
                    return len(collection)
                else:
                    return len(collection)
            elif key == "value":
                return value
            elif key == "path":
                # 'value' is the path string
                return resolve_path(game_state, value)
            elif key == "ref":
                # For variables temporarily stored in context during effect handling
                return context.get(value)
            else:
                raise NotImplementedError(f"Unknown condition operator: {key}")

        return False

    def resolve_operand(self, operand, game_state, context):
        """Resolves an operand node: can be {path:...}, {value:...}, or literal."""
        if isinstance(operand, dict):
            # If has a single key recognized operand
            if "value" in operand:
                return operand["value"]
            if "path" in operand:
                return resolve_path(game_state, operand["path"])
            if "ref" in operand:
                return context.get(operand["ref"])
            # allow recursive conditions
            for k in ["isEqual", "isGreaterThan", "isLessThan", "and", "or", "not", "max", "min", "count"]:
                if k in operand:
                    return self.evaluate_condition({k: operand[k]}, game_state, context)
            # e.g. for a filter expression or map/distinct/group_by, not implemented here.
        return operand

    def execute_effect(self, effect_list: List[Dict[str, Any]], game_state: Any, context: Dict[str, Any]=None):
        """Executes actions (effects) as specified in a Rule."""
        context = context or {}
        for action_def in effect_list:
            action_name = action_def.action
            action_func = self.actions.get(action_name)
            if action_func:
                # Remove extra meta keys reserved for CGML, except for function kwargs
                params = {k:v for k,v in action_def.__dict__.items() if k != 'action'}
                # Pass game_state and params, plus context (could be used for storing/referencing temporary results)
                action_func(game_state, context=context, **params)
            else:
                print(f"Action not implemented: {action_name}")

# --- Example action registry usage ---

# def my_move_action(game_state, from_, to, count=1, **kwargs):
#     ... actually move cards ...

# action_registry = {
#     "MOVE": my_move_action,
#     "SHUFFLE": my_shuffle_action,
#     # etc.
# }
# engine = RulesEngine(action_registry)