**AirDnD**

Ukraine solved the arithmetic that was bankrupting air defence. Their Sting interceptor costs two thousand dollars against the hundreds of thousands or millions a missile costs, and it has taken down several thousand drones. We cannot have it. Every one of those interceptors is flown by a trained pilot in goggles, one pilot per interceptor per engagement, sustained by a mobilised wartime population we do not have — and Ukraine has banned the export of them regardless. Meanwhile the target has outrun the answer: the jet drones now in mass production cruise at 300 to 400 km/h and the newest reach 500 to 600, faster than the interceptors chasing them. Even a copy would arrive obsolete, and building our own stock is the only route left.

**PROBLEM STATEMENT**
Ideate one layer of an autonomous interceptor swarm that needs no pilot — the drone itself, the terminal guidance, the swarm deployment logic, or the patrol and recharge cycle that keeps it airborne. Build it in software and showcase it working, measured against a stated baseline.

**ONBOARD AUTONOMY AND SWARM DEPLOYMENT**
A raid arrives as a swarm and the answer has to be a swarm. Two decisions sit here: which of your interceptors are mobilised at all — each has a cost, a position, and a state, airborne on patrol or docked on the ground — and then which of your drones takes which of theirs. Both have to be agreed between the drones themselves, because the ground link is the first thing an adversary removes. Build the coordination and allocation engine and run it against a simulated incoming swarm. Report leakage against a naive one-round-per-target baseline, and show drone-to-drone coordination, target reassignment when a round fails, and collision avoidance between your own aircraft.

Desc: air defence drone orchestrator & jam-resistant swarm coordination

NOTE: we should focus not just on jamming, but also on other variables as well

**Problem factors:**

* Who is the enemy:
  * Only normal enemy swarm drone
    * Preprogrammed drone, eg they’re programmed w script to target critical infrastructure (this bypasses jammers)
    * Mass attack: 1 controller 1 drone. This is likely as our enemies (eg malaysia / indo) have more ppl than us. But this can be easily countered w jamming
    * their max is 1k drones in a swarm
  * Target ukraine / russia type drones (we are not targeting Shahed-style drones)
  * They will launch their drones at the same time, concentrated from a particular location / direction (ie to try to overwhelm us)
* External variables/factors:
  * Inclement Weather (Rain, Strong Winds, Fog)
  * Flying creatures (e.g., pigeons)
* Drone Communication Jammer (Transmits strong radio noise on the frequencies a drone relies on, drowning out the real signals)
  * Jammer range can be more than 10 km, which could affect any other form of device that uses radio for communication
  * The jammer originates from either the blue team or an adversary, most likely the blue team tryna stop the enemies
  * Type of Jammer: Omnidirectional jammer, Directional Jammer, Radar Jammer
* What is our drone hardware:
  * kamikaze
  * Flight Controller (Specs depend on our computing) (at least 2 different chips for vision & processing (because vision is compute heavy))
    * Flight controller alr contains altitude, gyroscope, Altitude sensor (map the sky at different altitudes)
  * Camera
  * Cost: \$2500
    * Tactical military drones and swarm units used in Ukraine typically cost between \$500 and \$2,000 per individual drone
    * Military Times (March 2026): "These are Ukraine’s \$1,000 interceptor drones the Pentagon wants to buy" [https://www.militarytimes.com/news/pentagon-congress/2026/03/11/these-are-ukraines-1000-interceptor-drones-the-pentagon-wants-to-buy](https://www.militarytimes.com/news/pentagon-congress/2026/03/11/these-are-ukraines-1000-interceptor-drones-the-pentagon-wants-to-buy)
    * Interesting Engineering: Wild Hornets "Sting" interceptor drone [https://interestingengineering.com/military/ukraine-sting-interceptor-drone-russian-shaheds](https://interestingengineering.com/military/ukraine-sting-interceptor-drone-russian-shaheds)
  * Other hardware: ???
    * IR (for heat-seeking)???
    * Magnetic???
      * There is a GPS using magnetic fields
      * ![][image1]
    * Gnss denied???
* What intel do we receive:
  * Altitude location, specs of the enemy drone (eg 30 mins lifespan, speed, manueverability)
    * How to accurately classify what constitutes a drone, and how to do that w the lowest computing cost
* What is our swarm communication like:
  * Mesh network (master & slave)
  * Camera?
    * Drone Detection by training a model.
    * Marking using light? (e.g. Purple is Leader, Blue is Slave, Red is return to base)??? Or use other smart markers using encryption logic \[BUT this might expose all the drone locations. So is there a need to keep it hidden?)
  * Or Individual decision-making (but this is chaotic???)

More assumptions:

- “Spawn” means the moment the enemy drone is detected by Singapore (us)
- Enemy is trying to target our critical infrastructure (eg CBD (MBS), communications tower (telecoms), power plant, airfield)
- We must have an optimization engine where the computing cost of interception is low but also effective in taking down enemy drones

questions:

- what algorithms are best to tackle enemy swarm drones, esp if they come at varying altitudes simultaneously?
-

**Solution**

- We have a swarm of cheap drones
- Solution should be more localized, eg just marina bay sands (MBS) rather than whole of SG
- Don’t do everything; have a specific problem to solve
- Segment boundary for certain clusters of drones
  - eg diagonal segment boundary???
  - or 2 drones in 1 segment???
- We operate over sea / non-important areas. Eg if an enemy drone comes to somewhere sensitive like HDBs / MBS. And the second line of defence would be a drone laser weapon. (We need to ensure they won’t conflict with each other)
  - Divide into protected / non-protected zones
  - NOTE: our demo will NOT cover the lasers to prevent unnecessary features

More notes ([agents.md](http://agents.md)):

- Whilst the solution must be realistic it should also be novel / creative
- It should also be flashy (catch attention), we only have 2.5 mins to present

Resources:

- [https://clika.io/](https://clika.io/) (how to compress video feeds so it takes up less compute to process)
- [https://www.astranav.com/](https://www.astranav.com/) (magnetic field sensors to navigate (ie don’t need network/wifi))
- [https://creomagic.com/](https://creomagic.com/) (communication without wifi???)
- [https://www.uavnavigation.com/gnss-denied-navigation](https://www.uavnavigation.com/gnss-denied-navigation) (navigation without GPS???)
- [https://infinidome.com/ironav/](https://infinidome.com/ironav/) (uses GNSS denied)

NOTE:
??? means idk & maybe not relevant
\!\!\! means important and take note
