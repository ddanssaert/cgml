import React, { createContext, useContext, useState, useCallback } from 'react';
// Note: We're not dynamically loading YAML files in this demo implementation yet.
import { GameSimulator } from 'cgml-engine/src/simulator';
import { GameState } from 'cgml-engine/src/state';

interface GameContextType {
    simulator: GameSimulator | null;
    gameState: GameState | null;
    currentPlayerIdx: number;
    phaseIdx: number;
    legalActions: any[];
    isGameOver: boolean;
    loadGame: (yamlContent: string, playerCount?: number) => void;
    performAction: (actionEffect: any) => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [simulator, setSimulator] = useState<GameSimulator | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
    const [phaseIdx, setPhaseIdx] = useState(0);
    const [legalActions, setLegalActions] = useState<any[]>([]);

    const updateReactState = useCallback((sim: GameSimulator) => {
        // Force a new object reference to trigger re-renders if needed, 
        // though typically mutating and spreading or providing a version tick is better.
        // For simplicity, we create a shallow clone of the state object.
        setGameState(Object.assign(Object.create(Object.getPrototypeOf(sim.gameState)), sim.gameState));
        setCurrentPlayerIdx(sim.currentPlayerIdx);
        setPhaseIdx(sim.phaseIdx);

        const legal = sim.getLegalActions(sim.currentPlayerIdx);
        setLegalActions(legal);
    }, []);

    const loadGame = useCallback((yamlContent: string, playerCount: number = 2) => {
        // In a real browser environment, loadCgmlFile (which uses fs.readFileSync) won't work.
        // We need to bypass the Node.js `fs` loader and parse YAML directly using js-yaml in the browser.
        // For now, let's assume `loadCgmlFile` has been adjusted, or we parse it here and pass the parsed object.

        import('js-yaml').then(yaml => {
            try {
                // Simplified loading without !include for browser.
                const parsedDef = yaml.load(yamlContent);
                console.log("[DEBUG CGML] raw yaml length:", yamlContent.length);
                console.log("[DEBUG CGML] parsedDef keys:", parsedDef ? Object.keys(parsedDef) : null);
                console.log("[DEBUG CGML] parsed zones:", (parsedDef as any)?.zones);
                const sim = new GameSimulator(parsedDef as any, playerCount);
                setSimulator(sim);
                updateReactState(sim);
            } catch (e) {
                console.error("Failed to parse game YAML:", e);
            }
        });
    }, [updateReactState]);

    const performAction = useCallback((actionEffect: any[]) => {
        if (!simulator) return;

        // Try to execute the specific effect.
        // A full simulator.run() wrapper is tricky because run() blocks in a while loop until game over.
        // For an interactive UI, we need a step-by-step approach.
        // We will execute the single action effect, then let the simulator evaluate transitions and next phases.

        simulator.rulesEngine.executeEffect(actionEffect, simulator.gameState, simulator.context);

        // Handle transitions manually for interactive step
        if (simulator.context['$repeat_turn']) {
            simulator.context['$repeat_turn'] = false;
            simulator.phaseIdx = 0;
        } else {
            // Check transitions
            const transitions = simulator.flow.transitions || [];
            let transitioned = false;
            for (const t of transitions) {
                if (simulator.gameState.current_state !== t.from) continue;
                if (!t.condition || simulator.rulesEngine.evaluateCondition(t.condition, simulator.gameState, simulator.context)) {
                    simulator.gameState.current_state = t.to;
                    simulator.phaseIdx = 0;
                    transitioned = true;
                    break;
                }
            }

            if (!transitioned) {
                // Advance phase
                const phases = simulator.flow.states[simulator.gameState.current_state]?.phases || [];
                simulator.phaseIdx++;
                if (simulator.phaseIdx >= phases.length) {
                    simulator.phaseIdx = 0;
                    simulator.currentPlayerIdx = (simulator.currentPlayerIdx + 1) % simulator.playerCount;
                    simulator.context['$player'] = simulator.currentPlayerIdx;
                    simulator.context.player.current = simulator.gameState.players[simulator.currentPlayerIdx];
                }
            }
        }

        updateReactState(simulator);
    }, [simulator, updateReactState]);

    const isGameOver = gameState?.current_state === 'GameOver';

    return (
        <GameContext.Provider value={{
            simulator,
            gameState,
            currentPlayerIdx,
            phaseIdx,
            legalActions,
            isGameOver,
            loadGame,
            performAction
        }}>
            {children}
        </GameContext.Provider>
    );
};

export const useGameState = () => {
    const context = useContext(GameContext);
    if (context === undefined) {
        throw new Error('useGameState must be used within a GameProvider');
    }
    return context;
};
