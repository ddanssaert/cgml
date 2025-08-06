from typing import Any, Dict, List
import random
from src.engine import RulesEngine
from src.state import (
    GameState,
    build_game_state_from_cgml,
    run_setup_phase,
)
from src.loader import load_cgml_file

# --- Action Registry Setup ---
def move_action(game_state: GameState, from_: str, to: str, count: int = 1, context=None, **kwargs):
    # Implement the move cards logic, possibly reusing functions from state
    from src.state import find_zone, move_cards
    p = None
    # Resolve player context if needed. (Assume for now moves affect shared or per-player zones)
    from_zone = find_zone(game_state, from_, p)
    to_zone = find_zone(game_state, to, p)
    move_cards(from_zone, to_zone, count)

# More actions can be defined per your engine needs.
ACTION_REGISTRY = {
    "MOVE": move_action,
    # "DRAW": draw_action,
    # "SHUFFLE": shuffle_action,
    # ... add your other action functions and map them here
}

class GameSimulator:
    def __init__(self, cgml_definition: Any, player_count: int):
        """
        :param cgml_definition: Parsed CGML Definition object (from loader)
        """
        self.cgml_definition = cgml_definition
        self.rules_engine = RulesEngine(ACTION_REGISTRY)
        self.player_count = player_count
        self.game_state = self._initialize_state(cgml_definition)
        self.flow = cgml_definition.flow


        # You may want to track additional game-play context (turn, state, etc.)
        self.state_name = self.flow.initial_state
        self.current_player_idx = 0
        # ...any other tracking vars needed

    def _initialize_state(self, cgml_def: Any) -> GameState:
        # Compose the initial gamestate from the CGML definition using state.py helpers
        state = build_game_state_from_cgml(cgml_def, self.player_count)
        run_setup_phase(state)
        return state

    def get_legal_actions(self, player_id: int) -> List[Dict]:
        """
        Traverses all valid actions for the player in the current state context.
        Relevant rules/phases can be checked using the rules engine.
        """
        legal_actions = []
        # Example: Iterate over all rules; for each triggered by this phase,
        # use rules_engine.evaluate_condition to see if its preconditions are satisfied.
        current_phase = self._current_phase()
        for rule in self.cgml_definition.rules:
            if rule.trigger == f"on.phase.{current_phase}":
                # Evaluate its condition, if present; default to True if missing.
                if (not rule.condition or self.rules_engine.evaluate_condition(rule.condition.dict(by_alias=True), self.game_state)):
                    legal_actions.append({
                        "rule_id": rule.id,
                        "effect": rule.effect,  # You might also want effect/action preview
                    })
        return legal_actions

    def _current_phase(self):
        # Determine or return the current phase in flow.turn_structure/current turn
        # For demo, just return the first phase.
        return self.flow.turn_structure[0] if self.flow.turn_structure else "Playing"

    def run(self):
        """
        Example main loop advancing turns, getting actions, executing effects.
        """
        while True:
            # 1. Check win condition:
            # Use self.rules_engine.evaluate_condition if win is a condition tree or custom handler.
            if self._is_game_over():
                print("Game over!")
                break

            # 2. Legal actions for current player
            player_id = self.current_player_idx
            legal = self.get_legal_actions(player_id)
            # 3. Select action (stub: just use first legal, or prompt user)
            if not legal:
                print(f"No legal actions for player {player_id} in phase {self.state_name}")
                break

            selected_action = random.choice(legal)
            # 4. Execute effects using the rules engine
            self.rules_engine.execute_effect(selected_action['effect'], self.game_state)
            # 5. Advance turn, phase, etc., as per your flow config
            self._advance_turn()

    def _is_game_over(self) -> bool:
        """
        Uses the game's flow and win_condition to determine if the game is over.
        """
        # Example for a simple 'GameOver' state match.
        return self.state_name == "GameOver"

    def _advance_turn(self):
        """Advance to the next player/phase/state as per .flow definition."""
        # Demo stub: just cycle player
        num_players = len(self.game_state.players)
        self.current_player_idx = (self.current_player_idx + 1) % num_players

# --- Usage Example ---

if __name__ == "__main__":
    cgml = load_cgml_file("../war.yml")  # or any other CGML .yml game file
    simulator = GameSimulator(cgml, player_count=2)
    simulator.run()
