# SalvoCore

Smart Air Defense C2 with Jamming-Resilient Swarm Coordination

## Plain English Summary
Think of SalvoCore as an air defense system with two brains:
1. Ground AI: When 200 enemy drones attack at once, an AI analyzes the threat and gives the human commander 3 simple strategy buttons. The commander clicks one button, and the software instantly assigns all weapons without human panic or micromanagement.
2. Sky Backup: If enemy radio jammers cut the connection to the ground, the flying defense drones talk directly to each other like an auction, dividing up targets in milliseconds to finish the mission on their own.

## 1. Executive Summary
When hundreds of cheap enemy drones attack a city simultaneously, two things fail: human operators get overwhelmed trying to target them manually in seconds, and enemy radio jamming cuts communication to defense units.

SalvoCore is a two-tiered software platform that defeats mass drone attacks while keeping human commanders firmly in control:

1. Strategic Layer (Commander Intent & Agentic AI):
Instead of forcing an operator to manually target 200 individual drones, an agentic AI pipeline analyzes the whole attack, filters decoys, checks safety zones (keeping falling debris away from residential estates and airspace), and presents 3 clear strategy options. The commander authorizes the strategy with a single click, and the software handles the high-speed matching.

2. Tactical Layer (Jamming-Proof Swarm Coordination):
If enemy electronic warfare jams the radio link to base, flying interceptor drones switch to a decentralized local auction system. Communicating peer-to-peer over short-range mesh signals, the drones divide up remaining targets among themselves in milliseconds and finish the mission without a central ground connection.

## 2. Key Capabilities
- Human Control at Machine Speed: Keeps human judgment in the loop for high-level strategy without slowing down split-second defensive reactions.
- Resilient Under Heavy Jamming: Air defense continues operating seamlessly even when central radar and base station links are severed.
- Software-First & Low Cost: Hardware-agnostic architecture working with commercial off-the-shelf interceptor drones and standard defense data formats (Cursor-on-Target, MAVLink).

## 3. 2-Minute Hackathon Demo Flow
- 0:00 - 0:30 (Saturation Crisis): Inbound salvo of 150 drones over Singapore 3D map; traditional manual C2 gets overwhelmed.
- 0:30 - 1:00 (Agentic Decision): SalvoCore evaluates threat vectors, calculates collateral risk away from HDB blocks, and streams 3 clear strategy cards. Commander approves Option 1 with one click.
- 1:00 - 1:30 (EW Jamming Injected): Enemy turns on radio jamming; ground telemetry drops to zero. System alerts "Degrading to Edge Consensus".
- 1:30 - 2:00 (Autonomous Resolution): Defense drones coordinate targets locally peer-to-peer, intercept the remaining wave over the water, and return to base.
