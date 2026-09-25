# AirDnD: Smart Air Defense C2 with Jamming-Resilient Swarm Coordination

## 1. The Real-World Crisis (Why We Need This)
In modern warfare, an adversary can launch **200 cheap drones** (costing \$1,000–\$2,000 each) in a single saturation wave.
- **Traditional Missiles Fail:** Firing a \$1M Patriot missile at a \$2k drone causes instant economic and inventory collapse.
- **Singapore's Zero Strategic Depth:** Singapore is only **50 km wide**. When incoming drones cross the littoral waters, the armed forces have only **60 to 120 seconds** before they reach critical civilian infrastructure (HDB housing estates, Jurong Island refineries, Changi Airport).
- **The Two Bottlenecks:**
  1. *Operator Cognitive Overload:* A human operator cannot manually target and pair 200 individual threats in seconds without panicking or making catastrophic errors.
  2. *Electronic Warfare (EW) Jamming:* The enemy knows defense drones talk to a central base station, so they jam communications. If the ground link is cut, centralized air defense goes completely blind.

---

## 2. Plain English Summary: An Air Defense System with "Two Brains"

AirDnD solves this with a two-tiered software architecture:

```
                       [ 200 ENEMY DRONES INBOUND ]
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  BRAIN 1: THE GROUND AI (Human in Control at Machine Speed)            │
│  - Evaluates all 200 incoming threats and their trajectories.          │
│  - Calculates kinetic debris footprints away from dense HDB estates.   │
│  - Gives the human Commander 3 simple Strategy Cards:                  │
│      [1. Waterline Intercept]  [2. Asset Shield]  [3. Economy Reserve] │
│  - Commander authorizes strategy with a SINGLE CLICK.                  │
│  - Software handles split-second weapon-target matching instantly.     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                   *ENEMY TURNS ON RADIO JAMMING*
                (Connection to Ground is 100% Severed!)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  BRAIN 2: THE SKY BACKUP (Decentralized Swarm Consensus / EscrowCore)  │
│  - Defense drones in flight lose all communication with ground base.   │
│  - Instead of aborting, drones talk directly to each other over a      │
│    short-range, local peer-to-peer radio mesh.                         │
│  - Like an ultra-fast auction, they bid on targets among themselves    │
│    in under 50 milliseconds ("I take #12, you take #13").              │
│  - Bounded-counter CRDTs (EscrowCore) prevent multiple drones from     │
│    wasting ammo on the same target if the radio network fragments.     │
│  - If a drone misses or is shot down, targets are instantly re-bid.    │
│  - Intercepts all threats over littoral waters with ZERO leakage.      │
└────────────────────────────────────────────────────────────────────────┘
```

### Why the name "AirDnD"?
Like **Dungeons & Dragons**:
- The **Dungeon Master (Human Commander)** sets the overarching scenario, rules of engagement, and strategic intent.
- The **Adventuring Party (The Drone Swarm)** fights tactically as a team at the edge, coordinating their unique skills in real time and covering each other when chaos and radio silence hit.

---

## 3. The 2-Minute Hackathon Demo Script (What the Judges See)

On Demo Day, judges (including the Chief of Air Force and Chief Defence Scientist) will experience this exact 2-minute sequence:

### [0:00 – 0:30] Saturation Crisis on the 3D Map
- The laptop screen displays a 3D tactical digital twin of Singapore’s southern coast (Marina Bay, Sentosa, Jurong Island).
- Red/amber geofences highlight protected urban areas (HDB blocks).
- Radar blips detect a **100-drone mixed salvo** (Shaheds, jet drones, FPVs) approaching from the south.
- The system demonstrates how a traditional manual operator is hopelessly overwhelmed.

### [0:30 – 0:50] 1-Click Commander Intent Gating
- AirDnD’s Ground AI analyzes trajectories and streams **3 Strategy Cards**:
  - *Card 1: Waterline Intercept* (Prioritizes early kills over open water to keep falling debris completely clear of land).
  - *Card 2: High-Value Asset Shield* (Concentrates defense around Jurong Island fuel depots and Changi).
  - *Card 3: Economy / Reserve Mode* (Holds 30% of interceptors docked in case of a follow-on second wave).
- The user clicks **Card 1 (Waterline Intercept)** with **one click**. Defensive interceptor drones scramble immediately.

### [0:50 – 1:20] Electronic Warfare (EW) Blackout Injected
- A prominent red toggle is triggered: **`[SIMULATE ENEMY EW JAMMING]`**.
- A warning banner flashes across the HUD: **`GROUND TELEMETRY SEVERED (100% PACKET LOSS)`**.
- Ground radar and central C2 links disappear completely.
- Instead of failing, the HUD announces: **`DEGRADING TO EDGE CONSENSUS (P2P MESH)`**.

### [1:20 – 1:50] Autonomous Swarm Resolution at the Edge
- The 30 flying interceptors establish a glowing peer-to-peer mesh among themselves over the water.
- In under **50 milliseconds**, targets are auctioned and assigned locally.
- Mid-engagement, the presenter clicks to "destroy" Defender #5: instantly, nearby Defender #6 re-evaluates its bids and takes out the orphaned target.
- All enemy drones are neutralized over water. **0% leakage. Zero urban collateral.**

### [1:50 – 2:00] The Physical Hardware Anchor (ESP32-C6)
- The presenter points to the **physical ESP32-C6 board** plugged into the laptop:
  > *"This isn't just an animation. Node #1 of this swarm is running live right now on this \$4 microcontroller on the table. It is computing the auction bids and CRDT consensus in 3 milliseconds inside 512KB of memory."*
- The HUD displays real-time serial telemetry from the physical chip, proving real-world deployability on cheap, expendable drones.
