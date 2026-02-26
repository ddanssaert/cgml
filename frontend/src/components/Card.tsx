import React, { useMemo } from 'react';
import { Card as CardModel } from 'cgml-engine/src/state';

interface CardProps {
    card: CardModel;
    isSelected?: boolean;
    onClick?: (card: CardModel) => void;
    // For drag and drop later
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent, card: CardModel) => void;
}

export const Card: React.FC<CardProps> = ({ card, isSelected, onClick, draggable, onDragStart }) => {

    // Map card rank/suit to an asset path. Fallbacks to simple text if image fails/missing.
    const assetUrl = useMemo(() => {
        // If properties are missing, it might be a face-down card
        if (!card.properties || Object.keys(card.properties).length === 0) return '/assets/cards/back_blue.png';

        const rank = String(card.properties.rank || '').toLowerCase();
        let suit = String(card.properties.suit || '').toLowerCase();

        // Ensure suits are full names as per the user's provided files (e.g., 'clubs', 'diamonds')
        if (suit === 'c' || suit === '♣') suit = 'clubs';
        if (suit === 'd' || suit === '♦') suit = 'diamonds';
        if (suit === 'h' || suit === '♥') suit = 'hearts';
        if (suit === 's' || suit === '♠') suit = 'spades';

        if (rank && suit) {
            return `/assets/cards/${suit}_${rank}.png`;
        }
        return '/assets/cards/back_blue.png'; // default fallback for visual consistency
    }, [card.properties]);

    const rankDisplay = card.properties?.rank ?? '?';
    const suitDisplay = card.properties?.suit ?? '?';
    const isRed = suitDisplay.toLowerCase() === 'hearts' || suitDisplay.toLowerCase() === 'diamonds' || suitDisplay === '♥' || suitDisplay === '♦';

    const renderCardContent = () => {
        // We will try background-image first via inline style on the card div, 
        // and if it fails or isn't loaded, the fallback content underneath will show.
        // A cleaner way is using an <img> tag with onError, but background-image allows cleaner layout.
        return (
            <div className={`card-fallback ${isRed ? 'red' : ''}`}>
                <div className="suit" style={{ alignSelf: 'flex-start' }}>{rankDisplay}{suitDisplay.charAt(0)}</div>
                <div className="center-suit" style={{ fontSize: '2rem' }}>{suitDisplay.charAt(0)}</div>
                <div className="suit" style={{ alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>{rankDisplay}{suitDisplay.charAt(0)}</div>
            </div>
        );
    };

    return (
        <div
            className={`card-wrapper ${isSelected ? 'selected' : ''} ${onClick || draggable ? 'interactive' : ''}`}
            onClick={() => onClick && onClick(card)}
            draggable={draggable}
            onDragStart={(e) => onDragStart && onDragStart(e, card)}
        >
            <div
                className="card"
                style={assetUrl ? { backgroundImage: `url(${assetUrl})` } : {}}
            >
                {!assetUrl && renderCardContent()}
                {/* Optional overlay for selection could go here */}
            </div>
        </div>
    );
}
