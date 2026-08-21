/**
 * Input/transition protocol for the first intersection simulation.
 *
 * The renderer sends semantic signals, not UI gestures.
 * Subject switching is handled entirely here because it is a control-plane
 * operation, not a PDD movement calculation.
 */

const TURN_DIRECTIONS = ["left", "right", "straight"];

function createTurnSignal(direction) {
  if (!TURN_DIRECTIONS.includes(direction)) {
    throw new Error(`Unsupported turn direction: ${direction}`);
  }

  return { type: "turn", direction };
}

function createSubjectSwitchSignal(participantId) {
  return { type: "subject.switch", participant: participantId };
}

/** Apply subject change locally in the signal/control layer. */
function handleSubjectSwitch(state, participantId) {
  if (!state.participants?.[participantId]) {
    return {
      status: "rejected",
      reason: "unknown_participant",
      participant: participantId
    };
  }

  const participants = Object.fromEntries(
    Object.entries(state.participants).map(([id, participant]) => [
      id,
      { ...participant, controller: id === participantId ? "user" : "agent" }
    ])
  );

  return {
    status: "accepted",
    signal: createSubjectSwitchSignal(participantId),
    subject: participantId,
    next_state: { ...state, subject: participantId, participants }
  };
}

/**
 * Handle protocol-level signals. Movement signals are forwarded to the
 * computational layer; subject switching is consumed here.
 */
function handleSignal(state, participantId, signal) {
  if (!signal) return { status: "rejected", reason: "missing_signal" };

  if (signal.type === "subject.switch") {
    return handleSubjectSwitch(state, signal.participant);
  }

  if (signal.type !== "turn") {
    return { status: "rejected", reason: "unsupported_signal", signal };
  }

  if (!TURN_DIRECTIONS.includes(signal.direction)) {
    return { status: "rejected", reason: "unsupported_direction", signal };
  }

  if (!state.participants?.[participantId]) {
    return {
      status: "rejected",
      reason: "unknown_participant",
      participant: participantId
    };
  }

  return { status: "forward", signal, participant: participantId };
}

module.exports = {
  TURN_DIRECTIONS,
  createTurnSignal,
  createSubjectSwitchSignal,
  handleSubjectSwitch,
  handleSignal
};
