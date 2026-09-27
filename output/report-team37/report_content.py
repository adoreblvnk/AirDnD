"""Three-page report: problem -> information -> model -> scenarios -> evidence."""
import re
TITLE = 'HUSH: Coordination Without Communication for AirDnD'
AUTHORS = 'Joseph Poon, Lim Tze Kai, Lin Junyu, Alicia Tang'
def p(s): return ('p', s)
def h(s): return ('h', s)
def sub(s): return ('sub', s)
def pic(name, height, caption): return ('fig', name, height, caption)
COLUMNS = [
[
('abstract', '<b><i>Abstract—</i>HUSH (Handoff Under Signal Hostility) explores how a swarm keeps working when radio coordination disappears. AirDnD combines local observation, short-term memory, learned beliefs and temporary Observer roles in an inspectable simulation. Collective-behaviour research motivates this concept. We connect its architecture and training to four evaluation scenarios: large swarms, intelligent coordination, concentrated waves and hit/miss outcomes. Initial software results guide further validation.</b>'),
('keywords', '<b><i>Index Terms—</i></b>HUSH, local observation, communication-free coordination, swarm simulation.'),
h('I. PRIOR WORK AND OUR CONTRIBUTION'),
p('Track 3, Layer 03 concerns onboard autonomy under ground-link denial. AirDnD also assumes unavailable inter-drone radio links, making each aircraft dependent on its local view.'),
p('Reynolds demonstrated collective motion from local perception [1]. Muro et al. modelled wolf-pack coordination emerging without explicit communication or hierarchy [2]. Stander observed role specialisation in lion group hunts [3]. These studies motivate the analogy of group hunting and complementary roles. They provide distinct evidence from simulation and field observation; animal coordination can still involve observable social cues.'),
p('HUSH combines each drone’s observation history, learned estimates and temporary Observer role under radio silence. Each drone keeps its own record of what it sees and remembers. We compare this approach with fixed assignments, independent greedy decisions and estimates produced by handwritten rules. The reported results come from simulation.'),
pic('system-architecture.png', 220, 'Fig. 1. Software architecture. Offline preparation supplies the local model; execution produces logs for evaluator replay. ONNX/INT8 is a checked export branch.'),
],
[
p('We built a simulator, training pipeline and browser replay (Fig. 1). Autonomy evaluation teams and systems integrators use the prototype to trace outcomes back to local observations and beliefs, making communication-loss experiments easier to inspect and compare.'),
h('II. FROM DEPLOYMENT TO OBSERVATION'),
p('Figure 2 shows friendly drones in two roles: active interceptors in the lower layer and airborne reserves observing from above. An Observer is an ordinary friendly drone temporarily watching the scene. Each maintains its own observations; it sends no instructions to other drones.'),
pic('concept-layers.png', 178, 'Fig. 2. Conceptual altitude layers and sectors. Observers have a wider downward view. The amber ellipsoid illustrates uncertainty in a tracked object’s estimated position. Its size is schematic. Initial formation varies from this scene.'),
p('Initially, 25% of the total friendly fleet is held available as reserve. Figure 2 shows airborne reserves watching from the upper layer. Reserve describes availability; Observer describes the temporary sensing role of a drone that can see the relevant scene. The number of Observers changes during a run.'),
sub('A. Proposed sensing and onboard functions'),
p('Proposed onboard functions include a forward-looking camera, an accelerometer and gyroscope for motion sensing, a barometer for altitude, battery monitoring, a computer and flight control. A near-infrared beacon provides a proposed identity cue. This describes the sensing concept; hardware integration and a complete costed parts list remain future work.'),
sub('B. What can pass between aircraft'),
p('Each drone labels and remembers the objects it observes. Drones exchange no radio messages about object locations, assignments or intended actions. The proposed optical beacon carries identity information only. The simulator sends logs to the browser so a person can inspect the replay. That display connection is outside the simulated aircraft network.'),
],
[
h('III. ONE SCENE, DIFFERENT LOCAL VIEWS'),
p('Deployment only creates the opportunity to observe. A forward-facing camera loses sight of objects outside its field of view when the aircraft turns. An Observer may retain a wider view of the same scene. This difference, shown in Fig. 3, explains why HUSH needs both current observations and memory.'),
pic('local-visibility.png', 170, 'Fig. 3. Conceptual line of sight. The Observer can see the lower pair while the interceptor has a narrower forward view. Dashed lines show sight lines; positions are schematic.'),
sub('A. Inputs and remembered evidence'),
p('The proposed inputs describe four things: visible objects, the drone’s own condition, how reliable and recent each observation is, and its preloaded sectors and boundaries. Figure 4 groups these inputs. The current model uses a smaller set of numerical observations from recent simulation steps. Different views can therefore produce different estimates.'),
p('The simulator supplies numerical tracks and simplified navigation information. Camera recognition, full inertial sensing, optical beacon behaviour and physical battery performance are future validation work.'),
p('A local belief is a drone’s estimate based on its own observations. A private coverage window is a time-limited estimate that a previously observed task is already being handled. Losing sight of the scene makes that estimate less current. The replay should distinguish what is visible now, what is remembered and what is unknown.'),
sub('B. Consistency when evidence is ambiguous'),
p('Tie-breaking applies a fixed rule when choices are nearly equal, so the same inputs give a repeatable result. Hysteresis prevents small changes in an estimate from causing repeated switching. Both mechanisms help keep decisions stable when observations are uncertain.'),
p('The design specifies a three-count switching rule. A helper for this rule exists in the code, but the scenario runs initialise its state immediately. Those runs therefore do not demonstrate the full three-count behaviour. The rule remains part of the design being checked.'),
sub('C. From an expectation to an observed outcome'),
p('An Observer may still see an object after another drone has turned away. Its view can reveal that the visible outcome differs from what was expected. The fixed miss replay illustrates this difference and a subsequent role change. Section V explains what that example demonstrates.'),
],
[
h('IV. LEARNING THE LOCAL BELIEF MODEL'),
p('These limited views define the role of the model: estimate aspects of the local situation from a short history. Jev, developed by TypeSafe AI, provides the conceptual reference for System One judgments with structured answers and probabilities [4]. AirDnD implements its own compact numerical model.'),
pic('information-roles.png', 140, 'Fig. 4. Information roles in the proposed local view. Camera, navigation and identity labels describe assumptions. Implemented model inputs are a narrower numerical representation.'),
sub('A. Why the simplified System One design'),
p('A multilayer perceptron (MLP) processes the numerical observations. A gated recurrent unit (GRU) summarises recent observations. The model supplies estimates to explicit application rules. This compact design runs locally and makes inputs and outputs inspectable. AirDnD trains its own model; Jev supplies the conceptual reference.'),
sub('B. Training, checking and export'),
p('Simulation generates observation histories and reference answers for training, with OR-Tools supporting the assignment labels [5]. We use 256 training samples and 64 held-out samples kept separate from training. Training runs for 30 epochs, or passes through the training data. Held-out data use a different random seed and separate recorded streams.'),
p('Training loss decreases from 0.787 to 0.441; held-out loss decreases from 0.793 to 0.450. These results measure fit to synthetic examples. The pipeline saves PyTorch weights and checks ONNX/INT8 export on a finite batch. Scenario inference currently uses PyTorch; the INT8 export is 20,232 bytes.'),
sub('C. What a probability means'),
p('A 0–1 output estimates a named event from the available history. Application logic handles the eventual choice separately. Calibration checks whether similar forecasts match observed frequencies. For binary outcomes, we use the mean squared prediction-error form of the Brier score [6]:'),
('eq', r'\mathrm{BS}=\frac{1}{N}\sum_{k=1}^{N}(\hat p_k-y_k)^2.', 'Brier score for binary-event predictions.'),
p(r'Here $N$ counts examples, $\hat{p}_k$ is the forecast and $y_k$ is 1 when the event occurs and 0 otherwise. Lower scores indicate smaller error. Current calibration covers one output over a narrow probability range; broader checks are planned.'),
],
[
h('V. FOUR SCENARIOS, ONE EVIDENCE STORY'),
p('The scenarios test the same chain: what is visible, what each aircraft believes, what the event log records, and whether coverage remains. Each case below states the evidence available from our prototype.'),
sub('A. Big swarm — recorded benchmark'),
p('The main comparison uses 100 hostile objects and 125 friendly drones. Each method runs with the same 30 random seeds, allowing paired comparisons of the generated scenes. Separate scaling runs use 20 to 100 hostile objects. These runs show that the software executes at those sizes.'),
sub('B. Intelligence swarm — friendly coordination'),
p('This case concerns HUSH’s friendly swarm coordinating from separate local views. The replay exposes local observations, private beliefs and recorded decisions. The learned-versus-handwritten comparison examines the contribution of learning; current leakage outcomes are identical for those two versions.'),
sub('C. Wave of concentrated swarm — proposed'),
p('This proposed scenario tests several arrivals concentrated in one area. The current simulator creates one initial group. A dedicated repeated-wave test remains planned, including comparisons of different initial reserve shares.'),
sub('D. Hit and miss — fixed examples'),
p('The archive contains a forced-first-success replay and a forced-first-miss recovery replay. They demonstrate recorded event sequences. The small fixed examples help explain the local views; reliability under varied physical conditions remains unmeasured.'),
p('The proposed lifecycle also includes launch, reserve holding, replacement of empty positions and low-battery return to base. A coverage gap is an area with reduced observation after a drone leaves. Refill means occupying a vacated position. Short simulator runs cover parts of this lifecycle; sustained patrol and recharging remain to be evaluated.'),
h('VI. INITIAL COMPARISON'),
('table',),
p('Leakage is the percentage of hostile objects left unneutralised. Duplicates count additional simultaneous pursuits of the same object. AirDnD records 25.13% leakage, versus 34.80% for fixed assignments. Handwritten estimates give identical leakage in each run. Simple baselines initially use 94 aircraft; AirDnD considers all 125, so available resources differ.'),
],
[
h('VII. COMPLETING THE PICTURE'),
p('Identity also depends on available evidence. The concept distinguishes a confirmed friendly drone, a continuously tracked friendly drone, an unknown object and an object with hostile evidence. A missing identity signal leaves uncertainty. Appearance alone is insufficient when another drone has the same shape.'),
p('ORCA supplies a supporting collision-avoidance layer after application decisions [7]. Its research project acknowledges partial DARPA funding. Its role supports separation while HUSH addresses coordination. Continuous physical safety still requires dedicated evidence.'),
sub('A. Validation scope'),
p('The results describe software runs with simplified sensing and motion. The fixed miss replay illustrates an Observer role change; the main benchmark measures aggregate outcomes. Physical sensing, continuous flight, debris and recovery reliability are future validation tasks.'),
sub('B. Value and continuation'),
p('The immediate value is a repeatable way to study coordination when shared radio information disappears. Evaluators can inspect what each aircraft could observe, compare local beliefs and review the recorded outcome in one workflow. Next steps are repeated-wave evaluation, broader probability calibration, sensor realism and controlled non-weapon multi-robot safety studies. Deployment assessment would add costs and operating assumptions.'),
h('VIII. CONCLUSION'),
p('HUSH brings deployment, local sensing, memory, learned beliefs and temporary Observer roles into one coordination concept. The prototype connects training to local execution and visual replay. Initial software results provide a starting point for evaluating the four scenarios and extending the evidence through representative trials.'),
h('REFERENCES'),
('ref', '[1] C. W. Reynolds, “Flocks, herds, and schools: A distributed behavioral model,” ACM SIGGRAPH Computer Graphics, vol. 21, no. 4, pp. 25–34, 1987. doi: 10.1145/37402.37406.'),
('ref', '[2] C. Muro, R. Escobedo, L. Spector, and R. P. Coppinger, “Wolf-pack (Canis lupus) hunting strategies emerge from simple rules in computational simulations,” Behavioural Processes, vol. 88, no. 3, pp. 192–197, 2011. doi: 10.1016/j.beproc.2011.09.006.'),
('ref', '[3] P. E. Stander, “Cooperative hunting in lions: The role of the individual,” Behavioral Ecology and Sociobiology, vol. 29, no. 6, pp. 445–454, 1992. doi: 10.1007/BF00170175.'),
('ref', '[4] TypeSafe AI, “System One.” Accessed: Sept. 27, 2026. [Online]. Available: https://docs.typesafe.ai/concepts/system-one'),
('ref', '[5] Google, “Solving an assignment problem,” OR-Tools. Accessed: Sept. 27, 2026. [Online]. Available: https://developers.google.com/optimization/assignment/assignment_example'),
('ref', '[6] G. W. Brier, “Verification of forecasts expressed in terms of probability,” Monthly Weather Review, vol. 78, no. 1, pp. 1–3, 1950.'),
('ref', '[7] J. van den Berg, S. J. Guy, M. Lin, and D. Manocha, “Reciprocal n-body collision avoidance,” in Robotics Research, vol. 70, Springer, 2011, pp. 3–19. Project: https://gamma-web.iacs.umd.edu/ORCA/.'),
],
]
# IEEE numbering follows first appearance.
number_map={}
for blocks in COLUMNS:
 for block in blocks:
  if block[0]=='ref': continue
  for value in block[1:]:
   if isinstance(value,str):
    for number in re.findall(r'\[(\d+)\]',value):
     if number not in number_map:number_map[number]=len(number_map)+1
COLUMNS=[[tuple(re.sub(r'\[(\d+)\]',lambda m:'['+str(number_map[m.group(1)])+']',value) if isinstance(value,str) else value for value in block) for block in blocks] for blocks in COLUMNS]
positions=[i for i,block in enumerate(COLUMNS[-1]) if block[0]=='ref']
refs=sorted((COLUMNS[-1][i] for i in positions),key=lambda block:int(re.match(r'\[(\d+)\]',block[1]).group(1)))
for i,ref in zip(positions,refs):COLUMNS[-1][i]=ref
