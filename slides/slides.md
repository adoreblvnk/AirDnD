---
theme: default
title: AirDnD — Coordination Without Shared Truth
info: Six-slide SDTH 2026 pitch
aspectRatio: 16/9
canvasWidth: 1280
transition: none
mdc: true
fonts:
  sans: Barlow
  mono: JetBrains Mono
---

<div class="kicker">01 · WHAT EXISTS / WHAT IS NEW</div>

# Radios coordinate today’s swarms.<br><span>AirDnD removes them.</span>

<div class="compare-layout">
  <div class="compare-side existing">
    <h3>What exists today</h3>
    <strong>Central command or RF mesh</strong>
    <p>Shared tracks, assignment messages and handoffs coordinate each interceptor.</p>
    <p class="failure">Broadband jamming breaks the coordinator first.</p>
  </div>
  <div class="compare-arrow">→</div>
  <div class="compare-side new">
    <h3>What AirDnD adds</h3>
    <strong>Coordination without shared truth</strong>
    <p>Each drone observes motion, infers friendly intent and decides from its own noisy local view.</p>
    <p class="success">Zero ground links · zero mesh · zero assignment messages</p>
  </div>
</div>

<p class="problem-line">Hundreds of low-cost threats. Total RF + GNSS blackout. Intelligent interception without communication.</p>

<!--
Hundreds of lightweight hostile drones can approach while a jammer removes GNSS, ground control and every inter-drone link. Existing autonomous swarms depend on a coordinator or shared assignment table. AirDnD removes that dependency: physical motion becomes the message.
-->

---

<div class="kicker">02 · USER / TASK CHANGED</div>

# One task: defend a saturated corridor

<div class="user-layout">
  <div class="user-name">
    <span>PRIMARY USER</span>
    <strong>RSAF Air Defence and Operations Command</strong>
    <p>Air Surveillance and Control Group and coastal air-defence batteries.</p>
  </div>
  <div class="task-shift">
    <div>
      <span>TODAY</span>
      <h3>Allocate every engagement</h3>
      <p>Operators and RF C2 distribute tracks, assign weapons and coordinate a restrike.</p>
    </div>
    <div class="shift-arrow">→</div>
    <div class="changed">
      <span>WITH AIRDND</span>
      <h3>Define the corridor; supervise outcomes</h3>
      <p>Interceptors distribute targets, recover from misses and preserve separation locally.</p>
    </div>
  </div>
</div>

<div class="singapore-strip"><b>SINGAPORE CONDITION</b><span>50 km strategic depth</span><span>3–5 s terminal decisions</span><span>coastal critical infrastructure</span></div>

<!--
The user is RSAF ADOC, specifically the Air Surveillance and Control Group and coastal air-defence batteries. The task we change is saturation interdiction. Instead of allocating every engagement over a link, operators define the protected corridor, launch the fleet and supervise outcomes while the aircraft coordinate locally.
-->

---

<div class="kicker">03 · HOW IT WORKS</div>

# Learned beliefs. Inspectable decisions.

<svg class="runtime-flow" viewBox="0 0 1140 250" role="img" aria-label="AirDnD local runtime decision flow">
  <defs><marker id="runtime-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#1677a8" stroke-width="1.5"/></marker></defs>
  <g class="runtime-node"><circle cx="105" cy="110" r="62"/><text x="105" y="101">NOISY LOCAL</text><text x="105" y="123">TRACK HISTORY</text></g>
  <path class="runtime-line" d="M172 110 H265" marker-end="url(#runtime-arrow)"/>
  <g class="runtime-node accent"><circle cx="340" cy="110" r="68"/><text x="340" y="90">SYSTEM ONE</text><text x="340" y="112">GRU</text><text x="340" y="136" class="minor">P(leak · success · covered)</text></g>
  <path class="runtime-line" d="M413 110 H505" marker-end="url(#runtime-arrow)"/>
  <g class="runtime-node"><circle cx="580" cy="110" r="68"/><text x="580" y="101">MISSION</text><text x="580" y="123">UTILITY</text></g>
  <path class="runtime-line" d="M653 110 H745" marker-end="url(#runtime-arrow)"/>
  <g class="runtime-node"><circle cx="820" cy="110" r="68"/><text x="820" y="90">RECEDING</text><text x="820" y="112">HORIZON + PN</text><text x="820" y="136" class="minor">future intercept basket</text></g>
  <path class="runtime-line" d="M893 110 H985" marker-end="url(#runtime-arrow)"/>
  <g class="runtime-node accent"><circle cx="1050" cy="110" r="62"/><text x="1050" y="101">ORCA</text><text x="1050" y="123">SAFE VELOCITY</text></g>
</svg>

<div class="formula main-formula"><i>U</i><sub>ij</sub> = consequence · <i>P</i>(leak) · <i>P</i>(success) · [1 − <i>P</i>(covered)] − costs</div>

<div class="mechanism-strip"><span>PRIVATE COVERAGE WINDOWS</span><span>DETERMINISTIC TIE-BREAKING</span><span>SWITCHING HYSTERESIS</span><span>REVERSE-INS RTH</span></div>

<!--
Every drone runs the same loop. A compact GRU converts noisy local history into beliefs, not commands. Deterministic mission utility chooses the action. Receding-horizon guidance aims at the future intercept basket, proportional navigation closes the terminal geometry, and ORCA has final authority over unsafe velocities.
-->

---

<div class="kicker">04 · DEMO / STATED BASELINE</div>

# Measured against independent greedy pursuit

<div class="evidence-grid compact-grid">
  <div><strong>100</strong><span>hostiles per run</span></div>
  <div><strong>125</strong><span>interceptors</span></div>
  <div><strong>30</strong><span>paired seeds</span></div>
</div>

<div class="baseline-comparison">
  <div><span>INDEPENDENT GREEDY</span><strong>53.9%</strong><small>mean leakage</small></div>
  <div class="delta"><strong>−28.8 pp</strong><span>53.4% relative reduction</span></div>
  <div class="ours"><span>AIRDND</span><strong>25.1%</strong><small>mean leakage</small></div>
</div>

<div class="evidence-footer demo-footer">
  <div><b>0</b> simulated friendly collisions</div>
  <div><b>59.58 m</b> mean minimum separation</div>
  <div><b>19.2 ms</b> p95 full simulation</div>
</div>

<p class="evidence-disclaimer">Simulation evidence · fixed configuration · exact seeds, raw logs and SHA-256 manifest archived</p>

<!--
The visual demo used 20 hostiles so the lifecycle stayed legible. The frozen benchmark scales the same system to 100 hostiles and 125 interceptors across 30 paired seeds. Against independent greedy pursuit, mean leakage falls from 53.9 to 25.1 percent: a 28.8-point reduction, with zero simulated friendly collisions.
-->

---

<div class="kicker">05 · OWNED LIMITS</div>

# What works—and what does not yet

<div class="limits-layout">
  <div class="limit-primary">
    <span>BIGGEST DOUBT</span>
    <strong>Optical track stability in heavy tropical rain</strong>
    <p>AirDnD depends on seeing hostile and friendly motion. Dense rain, glare, smoke or aerosol obscurants can degrade intent inference into dead reckoning.</p>
  </div>
  <div class="limit-list">
    <div><b>Simulation only</b><span>No physical flight or aerodynamic validation.</span></div>
    <div><b>Sensor models are stubbed</b><span>NIR loss and MEMS drift are sampled, not bench-measured.</span></div>
    <div><b>Not zero leakage</b><span>25.1% mean leakage remains at 100-hostile scale.</span></div>
    <div><b>Saturation breaks reserves</b><span>Above the modeled density, refill capacity is exhausted.</span></div>
  </div>
</div>

<p class="owned-line">Claimed: software mechanism + simulation evidence. &nbsp; Not claimed: combat readiness or flight-proven performance.</p>

<!--
This is a software proof, not a flight-proven weapon. NIR detection loss and MEMS drift are modeled rather than measured. The biggest technical doubt is optical track stability through heavy tropical rain or obscurants. We also do not claim zero leakage: 25.1 percent remains at 100-hostile scale.
-->

---

<div class="kicker">06 · BUYER / NEXT</div>

# A software-defined autonomy payload

<div class="buyer-layout">
  <div class="buyer-copy">
    <span>WHO PAYS</span>
    <strong>DSTA · DSO · MINDEF</strong>
    <p>Licensed through a sovereign integrator such as ST Engineering for low-cost interceptor fleets.</p>
    <div class="unit-cost"><b>≈ S$1,150</b><span>modeled airframe + compute + dual optical seekers</span></div>
  </div>
  <svg class="roadmap final-roadmap" viewBox="0 0 580 400" role="img" aria-label="Roadmap from software proof through hardware and flight validation">
    <path d="M95 50 V335" stroke="#cfd8dc" stroke-width="3"/>
    <g class="roadmap-step"><circle cx="95" cy="65" r="11"/><text x="130" y="59">NOW</text><text x="130" y="82" class="roadmap-detail">software proof + reproducible evidence</text></g>
    <g class="roadmap-step"><circle cx="95" cy="155" r="11"/><text x="130" y="149">MONTHS 1–3</text><text x="130" y="172" class="roadmap-detail">five-node hardware-in-the-loop</text></g>
    <g class="roadmap-step"><circle cx="95" cy="245" r="11"/><text x="130" y="239">MONTHS 4–6</text><text x="130" y="262" class="roadmap-detail">controlled maritime EW flight trials</text></g>
    <g class="roadmap-step"><circle cx="95" cy="335" r="11"/><text x="130" y="329">MONTHS 7–9</text><text x="130" y="352" class="roadmap-detail">red-team trials + SAF integration</text></g>
  </svg>
</div>

<p class="closing-line">We will keep building it: from coordinated software proof to measured hardware autonomy under blackout.</p>

<!--
The buyers are DSTA, DSO and MINDEF, integrated through a sovereign prime such as ST Engineering. Our modeled interceptor cost is about 1,150 Singapore dollars including compute and dual optical seekers. We would use incubation to move from this software proof to five-node hardware-in-the-loop, controlled maritime EW flight trials, and then SAF integration.
-->
