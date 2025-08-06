from engine import RulesEngine
from loader import load_cgml_file
from state import build_game_state_from_cgml, run_setup_phase

if __name__ == '__main__':
    cgml_definition = load_cgml_file('../gofish.yml')
    print(cgml_definition)
    state = build_game_state_from_cgml(cgml_definition, player_count=4)
    print(state)
    run_setup_phase(state)
    print(state)

    action_registry = {
        "MOVE": print,
        "SHUFFLE": print,
    }
    engine = RulesEngine(action_registry)
