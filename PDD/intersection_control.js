/**
 * PDD intersection computation layer.
 *
 * The package owns state evaluation and participant control.
 * The platform only renders the returned state/transition and sends signals.
 */

const CONTROL_ORDER = [
  "traffic_controller",
  "traffic_light",
  "sign",
  "marking",
  "road_status",
  "default_rule"
];

const DEFAULT_PARTICIPANT_TYPE = "vehicle.car";
const DEFAULT_POLICY = "random_valid";

/**
 * Return the strongest active control source for an intersection.
 */
function resolveControl(state) {
  for (const source of CONTROL_ORDER) {
    if (state.controls?.[source] != null) {
      return {
        source,
        value: state.controls[source]
      };
    }
  }

  return {
    source: "default_rule",
    value: null
  };
}

/**
 * Resolve the binary relation for two equal-ranked participants.
 * Participant rank/type is intentionally not used yet.
 */
function resolvePair(state, a, b) {
  const control = resolveControl(state);

  return {
    subject: a,
    object: b,
    relation: control.value?.relation ?? "equal",
    basis: control.value?.rule ?? "pdd.default",
    control_source: control.source,
    status: "applicable"
  };
}

/**
 * Create the initial control state. One participant is user-controlled;
 * every other participant is autonomous by default.
 */
function initializeControl(state, subjectId = null) {
  const participants = state.participants ?? {};
  const ids = Object.keys(participants);
  const userId = subjectId ?? ids[0] ?? "A";

  const control = {};
  for (const id of ids) {
    control[id] = {
      mode: id === userId ? "user" : "agent",
      policy: id === userId ? null : DEFAULT_POLICY
    };
  }

  return {
    ...state,
    subject: userId,
    participants: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          ...participants[id],
          type: participants[id].type ?? DEFAULT_PARTICIPANT_TYPE,
          control: control[id]
        }
      ])
    )
  };
}

/**
 * Change the user-controlled subject by participant ID.
 * The previous subject becomes autonomous and the selected participant
 * becomes the user-controlled one.
 */
function switchSubject(state, participantId) {
  if (!state.participants?.[participantId]) {
    return {
      status: "rejected",
      reason: "unknown_participant",
      participant: participantId,
      state
    };
  }

  const participants = Object.fromEntries(
    Object.entries(state.participants).map(([id, participant]) => [
      id,
      {
        ...participant,
        control: {
          mode: id === participantId ? "user" : "agent",
          policy: id === participantId ? null : DEFAULT_POLICY
        }
      }
    ])
  );

  return {
    status: "accepted",
    subject: participantId,
    state: {
      ...state,
      subject: participantId,
      participants
    }
  };
}

/**
 * Return the currently available actions for one participant.
 * The package is the authority for this action space.
 */
function getAvailableActions(state, participantId) {
  const participant = state.participants?.[participantId];
  if (!participant) return [];

  // A later rule layer can replace this with actions derived from PDD.
  return participant.available_actions ?? [
    "straight",
    "left",
    "right",
    "stop"
  ];
}

/**
 * Autonomous agent chooses one action from the package-provided valid set.
 * No probability model is assumed at this stage.
 */
function chooseAgentAction(state, participantId) {
  const actions = getAvailableActions(state, participantId);
  if (actions.length === 0) return null;

  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

/**
 * Resolve all autonomous participants into one concrete action each.
 * The user subject is deliberately left unresolved until an external signal arrives.
 */
function resolveAutonomousActions(state) {
  const actions = {};

  for (const [id, participant] of Object.entries(state.participants ?? {})) {
    if (participant.control?.mode !== "agent") continue;

    actions[id] = {
      type: "movement",
      action: chooseAgentAction(state, id),
      policy: participant.control.policy ?? DEFAULT_POLICY
    };
  }

  return actions;
}

/**
 * Compute the current decision state for all participants.
 * The PDD package supplies valid actions; agents collapse their action
 * space to one action, while the user keeps the complete valid space.
 */
function computeDecisionState(state) {
  const initialized = state.subject
    ? state
    : initializeControl(state);

  const subject = initialized.subject;
  const userActions = getAvailableActions(initialized, subject);
  const agentActions = resolveAutonomousActions(initialized);

  return {
    subject,
    user_actions: userActions,
    agent_actions: agentActions,
    basis: initialized.basis ?? "pdd.default"
  };
}

/**
 * Apply an already validated action and produce the next package state.
 * Actual movement/rule resolution can be expanded here without involving
 * the rendering platform.
 */
function applyAction(state, participantId, action) {
  const validActions = getAvailableActions(state, participantId);

  if (!validActions.includes(action)) {
    return {
      status: "rejected",
      reason: "action_not_available",
      participant: participantId,
      action,
      basis: state.basis ?? "pdd.default",
      state
    };
  }

  const nextState = {
    ...state,
    last_action: {
      participant: participantId,
      action
    }
  };

  return {
    status: "accepted",
    participant: participantId,
    action,
    basis: state.basis ?? "pdd.default",
    state: nextState
  };
}

module.exports = {
  CONTROL_ORDER,
  DEFAULT_PARTICIPANT_TYPE,
  DEFAULT_POLICY,
  resolveControl,
  resolvePair,
  initializeControl,
  switchSubject,
  getAvailableActions,
  chooseAgentAction,
  resolveAutonomousActions,
  computeDecisionState,
  applyAction
};
