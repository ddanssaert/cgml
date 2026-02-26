import React, { useState } from 'react';
import { GameProvider, useGameState } from './hooks/useGameState';
import { GameBoard } from './components/GameBoard';

// Default YAML to load for demo.
const DEFAULT_GAME_YAML = `
format_version: 1.3
name: High Card Minimum
description: A tiny demo game derived from High Card.
components:
  component_types:
    deck_types:
      PlayingCards:
        composition:
          - type: template
            template: standard_suits
            values: [2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A]
  decks:
    main_deck:
      type: PlayingCards
  zones:
    - name: deck
      per_player: false
      of_deck: main_deck
    - name: table
      per_player: false
    - name: hand
      per_player: true
    - name: score_pile
      per_player: true

setup:
  - action: SHUFFLE
    target: zones.deck
  - action: DEAL
    from: zones.deck
    to: players.[*].zones.hand
    count: 5

flow:
  initial_state: Playing
  states:
    Playing:
      phases:
        - MainPhase

rules:
  - id: play_card
    trigger: on.phase.MainPhase
    effect:
      - action: MOVE
        from: $.players[$player].zones.hand
        to: $.zones.table
        count: 1
`;

const GameWrapper: React.FC = () => {
  const { loadGame, simulator } = useGameState();
  const [customYaml, setCustomYaml] = useState(DEFAULT_GAME_YAML);

  if (!simulator) {
    return (
      <div className="loader-container">
        <h1 style={{ color: 'var(--secondary-color)' }}>CGML React Interface</h1>
        <p style={{ maxWidth: 600, textAlign: 'center', marginBottom: '1rem', color: '#aaa' }}>
          Paste your CGML markup below to launch the engine.
        </p>
        <textarea
          value={customYaml}
          onChange={(e) => setCustomYaml(e.target.value)}
          style={{
            width: '80%',
            height: '300px',
            background: 'rgba(0,0,0,0.2)',
            color: '#eee',
            fontFamily: 'monospace',
            padding: '1rem',
            border: '1px solid var(--glass-border)',
            borderRadius: '8px'
          }}
        />
        <button className="load-btn" onClick={() => loadGame(customYaml, 2)}>
          Start Game
        </button>
      </div>
    );
  }

  return <GameBoard />;
};

function App() {
  return (
    <GameProvider>
      <GameWrapper />
    </GameProvider>
  );
}

export default App;
