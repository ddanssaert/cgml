import React, { useState } from 'react';
import { useGameState } from '../hooks/useGameState';
import { Zone } from './Zone';
import { Card as CardModel, Zone as ZoneModel } from 'cgml-engine/src/state';

export const GameBoard: React.FC = () => {
    const { gameState, currentPlayerIdx, legalActions, performAction, isGameOver } = useGameState();
    const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());

    if (!gameState) return <div className="loader-container">Loading game state...</div>;

    const p1 = gameState.players[0];
    const p2 = gameState.players[1]; // Assuming 2 player for now

    // --- Interaction Handlers ---

    const toggleCardSelection = (card: CardModel) => {
        const newSelected = new Set(selectedCards);
        if (newSelected.has(card.id)) {
            newSelected.delete(card.id);
        } else {
            newSelected.add(card.id);
        }
        setSelectedCards(newSelected);
    };

    const handleDragStart = (e: React.DragEvent, card: CardModel, fromZone: ZoneModel) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ cardId: card.id, zoneId: fromZone.id || fromZone.name }));
        // Also select the card so visual feedback is consistent
        setSelectedCards(new Set([card.id]));
    };

    const handleDrop = (e: React.DragEvent, targetZone: ZoneModel) => {
        const rawData = e.dataTransfer.getData('text/plain');
        if (!rawData) return;

        try {
            const data = JSON.parse(rawData);

            // Find a legal action that matches a MOVE of the dragged card or from the source zone
            // to the target zone.
            const matchingAction = legalActions.find(act => {
                if (!act.effect) return false;

                // For MVP, look for a MOVE action in the effect array
                const moveObj = act.effect.find((eff: any) => eff.action === 'MOVE' || eff.action === 'MOVE_ALL');
                if (!moveObj) return false;

                // Simple heuristic: if the rule's intended destination matches the drop target's name
                // This logic would need to be expanded for complex rules (like Wippen's builds).
                // Let's assume a match if the destination path includes the target zone's name.

                let toPath = '';
                if (typeof moveObj.to === 'string') toPath = moveObj.to;
                if (typeof moveObj.to === 'object' && moveObj.to.path) toPath = moveObj.to.path;

                return toPath.includes(targetZone.name);
            });

            if (matchingAction) {
                console.log(`Executing matched action for drop: ${matchingAction.rule_id || 'unnamed'}`);

                // Inform the simulator of the specific card that triggered this if it requires context.
                // Depending on the robustness of ast_evaluator, we might need to inject standard 
                // engine variables (like $card) here. For the demo, dispatching the effect is enough.

                // Ideally, we might pass a context: { '$cardId': data.cardId } to `performAction`
                // But `performAction` in `useGameState` currently only takes the effect array.
                // We'd have to update `useGameState` to pass context, but let's try just executing the action first.
                performAction(matchingAction.effect);
                setSelectedCards(new Set()); // clear selection after
            } else {
                console.log(`No legal action matches moving card ${data.cardId} to ${targetZone.name}`);
            }

        } catch (err) {
            console.error("Drop handling failed", err);
        }
    };

    // Centralize shared zones + any specific 'play_area' or 'table' zones from players
    const tableZones: ZoneModel[] = Object.values(gameState.shared_zones);
    const p1Zones: ZoneModel[] = [];
    const p2Zones: ZoneModel[] = [];

    if (p1) {
        for (const z of Object.values(p1.zones) as ZoneModel[]) {
            if (z.name.includes('play_area') || z.name.includes('table')) tableZones.push(z);
            else p1Zones.push(z);
        }
    }
    if (p2) {
        for (const z of Object.values(p2.zones) as ZoneModel[]) {
            if (z.name.includes('play_area') || z.name.includes('table')) tableZones.push(z);
            else p2Zones.push(z);
        }
    }

    return (
        <div className="game-board">
            <header>
                <h1>CGML Arena</h1>
                <p>Status: {isGameOver ? 'Game Over' : `Turn: ${gameState.players[currentPlayerIdx].name}`}</p>
            </header>

            {/* Player 2 Area (Top) */}
            {p2 && (
                <div className={`player-area opponent ${currentPlayerIdx === 1 ? 'active-player' : ''}`} style={{ opacity: currentPlayerIdx === 1 ? 1 : 0.7, transform: 'scale(0.9)', transformOrigin: 'top center', transition: 'opacity 0.3s' }}>
                    <div className="glass" style={{ textAlign: 'center', marginBottom: '0.5rem', borderColor: currentPlayerIdx === 1 ? 'var(--secondary-color)' : 'var(--glass-border)' }}>
                        {p2.name} {currentPlayerIdx === 1 ? '(Active Turn)' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {p2Zones.map(zone => (
                            <Zone key={zone.name} zone={zone} onCardClick={toggleCardSelection} selectedCards={selectedCards} onDragStartEvent={handleDragStart} onDrop={handleDrop} />
                        ))}
                    </div>
                </div>
            )}

            {/* Shared Table Area (Middle) */}
            <div className="table-area">
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '800px' }}>
                    {tableZones.map((zone, i) => (
                        <Zone
                            key={`${zone.name}-${i}`}
                            zone={zone}
                            onDrop={handleDrop}
                            onCardClick={toggleCardSelection}
                            selectedCards={selectedCards}
                            onDragStartEvent={handleDragStart}
                        />
                    ))}
                </div>
            </div>

            {/* Player 1 Area (Bottom) */}
            {p1 && (
                <div className={`player-area current-player ${currentPlayerIdx === 0 ? 'active-player' : ''}`} style={{ opacity: currentPlayerIdx === 0 ? 1 : 0.8, transition: 'opacity 0.3s' }}>
                    <div className="glass" style={{ textAlign: 'center', marginBottom: '0.5rem', borderColor: currentPlayerIdx === 0 ? 'var(--secondary-color)' : 'var(--glass-border)' }}>
                        {p1.name} (You) {currentPlayerIdx === 0 ? '(Active Turn)' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {p1Zones.map(zone => (
                            <Zone
                                key={zone.name}
                                zone={zone}
                                onCardClick={toggleCardSelection}
                                selectedCards={selectedCards}
                                onDragStartEvent={handleDragStart}
                                onDrop={handleDrop}
                            />
                        ))}
                    </div>

                    {/* Available Actions - Only show if it's Player 1's turn (or if we want hotseat, show always) */}
                    {!isGameOver && (
                        <div className="controls">
                            {legalActions.length === 0 ? (
                                <div style={{ color: '#aaa', fontStyle: 'italic' }}>Waiting for engine...</div>
                            ) : (
                                legalActions.map((action, idx) => (
                                    <button
                                        key={idx}
                                        className="action-btn"
                                        onClick={() => {
                                            performAction([action]);
                                            setSelectedCards(new Set());
                                        }}
                                    >
                                        {action.rule_id || `Action ${idx + 1}`}
                                    </button>
                                ))
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
