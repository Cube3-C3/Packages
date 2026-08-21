/**
 * Input/transition layer for the first intersection simulation.
 *
 * The renderer sends semantic signals, not UI gestures:
 *   { type: "turn", direction: "left" }
 *   { type: "turn", direction: "right" }
 *   { type: "turn", direction: "straight" }
 *
 * This module validates the signal against the current intersection state.
 * A successful signal produces the next state; an invalid signal produces a
 * structured rejection that can later be projected as an animation, warning,
 * collision, or other consequence.
 */

const { resolvePair } = require("./intersection_control");

const TURN_DIRECTIONS = ["left", "right", "straight"];

function createTurnSignal(direction) {
  if (!TURN_DIRECTIONS.includes(direction)) {
    throw new Error(`Unsupported turn direction: ${direction}`);
  }

  return {
    type: "turn",
    direction
  };
}

/**
 * Resolve whether a participant may perform the requested movement.
 *
 * The current experiment assumes two equal-ranked cars. The intersection
 * state supplies the applicable relation and the participant's legal actions.
 *
 * @param {object} state
 * @param {string} participantId
 * @param {object} signal
 * @returns {object}
 */
function handleSignal(state, participantId, signal) {
  if (!signal || signal.type !== "turn") {
    return {
      status: "rejected",
      reason: "unsupported_signal",
      signal
    };
  }

  if (!TURN_DIRECTIONS.includes(signal.direction)) {
    return {
      status: "rejected",
      reason: "unsupported_direction",
      signal
    };
  }

  const participant = state.participants?.[participantId];
  if (!participant) {
    return {
      status: "rejected",
      reason: "unknown_participant",
      participant: participantId
    };
  }

  const allowed = participant.allowed_directions ?? TURN_DIRECTIONS;
  if (!allowed.includes(signal.direction)) {
    return {
      status: "rejected",
      reason: "movement_not_allowed",
      participant: participantId,
      signal,
      basis: participant.movement_rule ?? "pdd.8"
    };
  }

  const otherId = Object.keys(state.participants).find((id) => id !== participantId);
  if (!otherId) {
    return {
      status: "rejected",
      reason: "missing_conflict_participant"
    };
  }

  const relation = resolvePair(state, participantId, otherId);

  if (relation.relation === "must_yield" && relation.subject === participantId) {
    return {
      status: "rejected",
      reason: "must_yield",
      signal,
      relation,
      basis: relation.basis
    };
  }

  const nextState = {
    ...state,
    participants: {
      ...state.participants,
      [participantId]: {
        ...participant,
        movement: signal.direction,
        state: "moving"
      }
    },
    last_action: {
      participant: participantId,
      signal
    }
  };

  return {
    status: "accepted",
    signal,
    relation,
    basis: relation.basis,
    next_state: nextState
  };
}

module.exports = {
  TURN_DIRECTIONS,
  createTurnSignal,
  handleSignal
};
