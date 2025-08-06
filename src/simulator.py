from typing import Any, Dict, List, Optional
import random
import logging
from src.engine import RulesEngine
from src.state import (
    GameState,
    build_game_state_from_cgml,
    run_setup_phase,
)
from src.loader import load_cgml_file

# Set up debug logger
logger = logging.getLogger("simulator")
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter('[%(levelname)s] %(message)s'))
    logger.addHandler(ch)

# --- Action Registry Setup ---
def move_action(game_state: GameState, from_: str, to: str, count: int = 1, context=None, **kwargs):
    # Implement the move cards logic, possibly reusing functions from state
    from src.state import find_zone, move_cards
    p = None
    # Resolve player context if needed. (Assume for now moves affect shared or per-player zones)
    from_zone = find_zone(game_state, from_, p)
    to_zone = find_zone(game_state, to, p)
    move_cards(from_zone, to_zone, count)

def move_all_action(game_state, from_, to, context=None, **kwargs):
    from src.state import find_zone, move_all_cards
    from_zone = find_zone(game_state, from_)
    to_zone = find_zone(game_state, to)
    move_all_cards(from_zone, to_zone)

def set_game_state_action(game_state, state, context=None, **kwargs):
    # Set the state on the simulator for stateful progression
    game_state.current_state = state

def shuffle_action(game_state: GameState, target: str, context=None, **kwargs):
    from src.state import find_zone, shuffle_zone
    zone = find_zone(game_state, target)
    shuffle_zone(zone)

ACTION_REGISTRY = {
    "MOVE": move_action,
    "MOVE_ALL": move_all_action,
    "SET_GAME_STATE": set_game_state_action,
    "SHUFFLE": shuffle_action,
    # ...
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

        self.game_state.current_state = self.flow.initial_state
        self.current_player_idx = 0
        self.phase_idx = 0
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
                if not rule.condition or self.rules_engine.evaluate_condition(rule.condition, self.game_state):
                    legal_actions.append({
                        "rule_id": rule.id,
                        "effect": rule.effect,  # You might also want effect/action preview
                    })
        return legal_actions

    def _get_phases_for_state(self, state_name: str) -> List[str]:
        """
        Get the phase list for the current state from self.flow.states.

        Returns an empty list if state not found or has no phases (e.g. GameOver).
        """
        state_def = self.flow.states.get(state_name)
        if state_def and state_def.phases:
            return state_def.phases
        return []

    def _current_phase(self) -> Optional[str]:
        phases = self._get_phases_for_state(self.game_state.current_state)
        if 0 <= self.phase_idx < len(phases):
            return phases[self.phase_idx]
        else:
            return None  # E.g. GameOver or invalid

    def _check_state_transitions(self):
        """
        Checks all transitions from the current state. If one condition is true, advances to the next state.
        Returns True if a transition was taken; False otherwise.
        """
        transitions = self.flow.transitions or []
        for t in transitions:
            if t.from_ == self.game_state.current_state:
                if not t.condition or self.rules_engine.evaluate_condition(t.condition, self.game_state):
                    self.game_state.current_state = t.to
                    self.phase_idx = 0
                    return True
        return False


    def run(self):
        """
        Main loop advancing turns, getting actions, executing effects.
        Handles state transitions and resets phase index accordingly.
        """
        while True:
            logger.debug(
                f"Sim state: {self.game_state.current_state}, phase: {self._current_phase()}, player: {self.current_player_idx}"
            )
            card_counts = ',\t'.join([f'{z.name}: {len(z.cards)}' for z in self.game_state.shared_zones.values()] + [f'{p.name} {z.name}: {len(z.cards)}' for p in self.game_state.players for z in p.zones.values()])
            logger.info(
                f"Zone card counts: {card_counts}"
            )

            if self._is_game_over():
                logger.debug("Game over detected by simulator.")
                print("Game over!")
                break

            player_id = self.current_player_idx
            legal = self.get_legal_actions(player_id)

            if not legal:
                logger.debug(
                    f"No legal actions for player {player_id} in phase {self._current_phase()}. Attempting to advance phase."
                )
                if not self._advance_phase():
                    logger.debug("No more phases to advance. Breaking simulation loop.")
                    break
                continue

            prev_state_name = self.game_state.current_state
            selected_action = random.choice(legal)
            logger.debug(
                f"Executing action (rule_id={selected_action['rule_id']}) with effect: {selected_action['effect']}"
            )
            self.rules_engine.execute_effect(selected_action['effect'], self.game_state)

            # Check if state changed (e.g. SET_GAME_STATE)
            if self.game_state.current_state != prev_state_name:
                logger.debug(f"State changed {prev_state_name} -> {self.game_state.current_state}; resetting phase index.")
                self.phase_idx = 0
                continue  # Restart with new state's phases

            if self._check_state_transitions():
                logger.debug(
                    f"State changed by flow.transition to {self.game_state.current_state}; resetting phase index.")
                if self._is_game_over():
                    logger.debug(
                        f"Sim state: {self.game_state.current_state}, phase: {self._current_phase()}, player: {self.current_player_idx}"
                    )
                    card_counts = ',\t'.join(
                        [f'{z.name}: {len(z.cards)}' for z in self.game_state.shared_zones.values()] + [
                            f'{p.name} {z.name}: {len(z.cards)}' for p in self.game_state.players for z in
                            p.zones.values()])
                    logger.info(
                        f"Zone card counts: {card_counts}"
                    )
                    print("Game over!")
                    break
                continue

            self._advance_phase()

    def _is_game_over(self) -> bool:
        """
        Uses the game's flow and win_condition to determine if the game is over.
        """
        # Example for a simple 'GameOver' state match.
        return self.game_state.current_state == "GameOver"

    def _advance_turn(self):
        """Advance to the next player/phase/state as per .flow definition."""
        # Demo stub: just cycle player
        num_players = len(self.game_state.players)
        old_idx = self.current_player_idx
        self.current_player_idx = (self.current_player_idx + 1) % num_players
        logger.debug(f"Advanced turn: player {old_idx} -> {self.current_player_idx}")

    def _advance_phase(self) -> bool:
        """
        Advance to next phase for the current state, resetting if past end.
        Returns False if there are no phases (e.g. in terminal states).
        """
        phases = self._get_phases_for_state(self.game_state.current_state)
        if not phases:
            logger.debug(f"No phases in state {self.game_state.current_state}.")
            return False
        old_idx = self.phase_idx
        self.phase_idx += 1
        if self.phase_idx >= len(phases):
            self.phase_idx = 0
            self._advance_turn()
            logger.debug(
                f"Phase wrapped for state {self.game_state.current_state}. Advancing to new turn."
            )
            return False
        logger.debug(
            f"Advanced phase {old_idx} -> {self.phase_idx} ({phases[self.phase_idx]}) in state {self.game_state.current_state}."
        )
        return True

# --- Usage Example ---
if __name__ == "__main__":
    cgml = load_cgml_file("../war.yml")  # or any other CGML .yml game file
    simulator = GameSimulator(cgml, player_count=2)
    simulator.run()
