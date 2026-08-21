/**
 * Minimal experiment for the PDD intersection control hierarchy.
 *
 * Participants are intentionally equal-ranked in this first stage.
 * The resolver only determines which control source is active.
 * Participant rank is introduced later as a separate factor.
 */

const CONTROL_ORDER = [
  "traffic_controller",
  "traffic_light",
  "sign",
  "marking",
  "road_status",
  "default_rule"
];

/**
 * Return the strongest active control source for an intersection.
 * @param {object} state
 * @returns {{source: string, value: object|null}}
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
 * Resolve a binary relation for two equal-ranked participants.
 * This stage deliberately does not use participant type/rank.
 * @param {object} state
 * @param {string} a
 * @param {string} b
 * @returns {object}
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

module.exports = {
  CONTROL_ORDER,
  resolveControl,
  resolvePair
};
