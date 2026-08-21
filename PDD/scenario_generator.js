/**
 * Scenario generation layer for the intersection prototype.
 *
 * The generator does not resolve PDD rules. It materializes a world around
 * the current subject from explicit requirements and leaves unspecified
 * properties variable.
 *
 * Required entities are anchors: if a requirement names an entity or
 * condition, the generator must materialize it. Everything not fixed by the
 * requirements remains available for variation.
 */

const DEFAULT_ENVIRONMENT = {
  traffic_side: "right",
  climate: "temperate"
};

const NODE_TYPES = ["junction", "intersection"];
const CONTROL_TYPES = ["none", "traffic_light", "traffic_controller"];

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function createSegment(id, overrides = {}) {
  return {
    id,
    type: "road_segment",
    structural_rank: overrides.structural_rank ?? 1,
    surface: overrides.surface ?? randomChoice(["paved", "paved"]),
    markings: overrides.markings ?? [],
    ...overrides
  };
}

function createParticipant(id, overrides = {}) {
  return {
    id,
    type: "vehicle.car",
    controller: "agent",
    segment: null,
    ...overrides
  };
}

function normalizeRequirements(requirements = {}) {
  return {
    node_type: requirements.node_type ?? "intersection",
    approaches: requirements.approaches ?? 4,
    control: requirements.control ?? "none",
    required_entities: requirements.required_entities ?? [],
    subject: requirements.subject ?? null,
    participants: requirements.participants ?? 2
  };
}

/**
 * Generate a local scenario around the current subject.
 * `previousContext` is intentionally preserved so generation can continue
 * from the road segment on which the user is already travelling.
 */
function generateScenario({ previousContext = null, requirements = {}, environment = {} } = {}) {
  const req = normalizeRequirements(requirements);
  const env = { ...DEFAULT_ENVIRONMENT, ...environment };
  const approachCount = Math.max(3, req.approaches);

  const segments = {};
  for (let i = 0; i < approachCount; i += 1) {
    const id = `segment_${String.fromCharCode(65 + i)}`;
    segments[id] = createSegment(id, {
      traffic_side: env.traffic_side
    });
  }

  // Explicit structural anchors can be supplied as pairs of equal-rank
  // approaches. Otherwise the generator creates one random equal-rank pair.
  const priorityPair = req.priority_pair ?? ["segment_A", "segment_C"];
  priorityPair.forEach((id) => {
    if (segments[id]) segments[id].structural_rank = 1;
  });
  Object.keys(segments).forEach((id) => {
    if (!priorityPair.includes(id)) segments[id].structural_rank = 2;
  });

  const control = CONTROL_TYPES.includes(req.control) ? req.control : "none";

  const participants = {};
  const participantIds = [];
  for (let i = 0; i < req.participants; i += 1) {
    const id = `participant_${i + 1}`;
    const segmentIds = Object.keys(segments);
    const segment = segmentIds[i % segmentIds.length];
    participants[id] = createParticipant(id, { segment });
    participantIds.push(id);
  }

  const subject = req.subject ?? participantIds[0];
  if (participants[subject]) {
    participants[subject].controller = "user";
  }

  return {
    environment: env,
    previous_context: previousContext,
    node: {
      type: NODE_TYPES.includes(req.node_type) ? req.node_type : "intersection",
      id: "node_001",
      approaches: Object.keys(segments),
      control
    },
    segments,
    participants,
    subject,
    requirements: req
  };
}

module.exports = {
  DEFAULT_ENVIRONMENT,
  createSegment,
  createParticipant,
  normalizeRequirements,
  generateScenario
};
