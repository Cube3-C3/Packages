/**
 * Rebuild a canonical AST for a selected input/output pair.
 *
 * The canonical structures in Fis_data/AST.json use positional operands
 * O1..On. This module does not calculate coefficients. It only rebuilds
 * operand positions so that:
 *   - selected output becomes O1;
 *   - selected input becomes On;
 *   - all remaining operands keep their relative order.
 *
 * The returned AST is a new object; the canonical AST is never mutated.
 */

/**
 * Collect operand positions occurring in an AST.
 * @param {object} ast
 * @returns {string[]}
 */
function collectOperandIds(ast) {
  const ids = new Set();

  function visit(node) {
    if (!node || typeof node !== "object") return;

    if (typeof node.operand_id === "string") {
      ids.add(node.operand_id);
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    Object.values(node).forEach(visit);
  }

  visit(ast);

  return [...ids].sort((a, b) => {
    const na = Number(a.slice(1));
    const nb = Number(b.slice(1));
    return na - nb;
  });
}

/**
 * Replace operand IDs recursively without changing AST structure.
 * @param {object} ast
 * @param {Map<string, string>} mapping
 * @returns {object}
 */
function remapOperands(ast, mapping) {
  if (Array.isArray(ast)) {
    return ast.map((node) => remapOperands(node, mapping));
  }

  if (!ast || typeof ast !== "object") {
    return ast;
  }

  if (typeof ast.operand_id === "string") {
    return {
      ...ast,
      operand_id: mapping.get(ast.operand_id) ?? ast.operand_id
    };
  }

  return Object.fromEntries(
    Object.entries(ast).map(([key, value]) => [
      key,
      remapOperands(value, mapping)
    ])
  );
}

/**
 * Build a positional mapping for a selected output/input pair.
 *
 * Output is assigned to O1 and input to the last operand position.
 * Remaining operands are assigned to the free positions in their original
 * order. No coefficient values are inferred or changed here.
 *
 * @param {string[]} operandIds
 * @param {string} inputOperandId
 * @param {string} outputOperandId
 * @returns {Map<string, string>}
 */
function buildOperandMapping(operandIds, inputOperandId, outputOperandId) {
  if (!operandIds.includes(inputOperandId)) {
    throw new Error(`Unknown input operand: ${inputOperandId}`);
  }

  if (!operandIds.includes(outputOperandId)) {
    throw new Error(`Unknown output operand: ${outputOperandId}`);
  }

  if (inputOperandId === outputOperandId) {
    throw new Error("Input and output operands must be different.");
  }

  const lastPosition = `O${operandIds.length}`;
  const targetPositions = operandIds.filter(
    (id) => id !== "O1" && id !== lastPosition
  );

  const mapping = new Map();
  mapping.set(outputOperandId, "O1");
  mapping.set(inputOperandId, lastPosition);

  const remainingSource = operandIds.filter(
    (id) => id !== inputOperandId && id !== outputOperandId
  );

  const remainingTargets = targetPositions.filter(
    (id) => id !== outputOperandId && id !== inputOperandId
  );

  remainingSource.forEach((sourceId, index) => {
    mapping.set(sourceId, remainingTargets[index]);
  });

  return mapping;
}

/**
 * Rebuild a canonical AST for a newly selected input/output pair.
 *
 * If output changes, the AST is structurally rebuilt as a new tree before
 * the positional remapping is applied. If only input changes, the same
 * positional reconstruction path is used without coefficient calculation.
 *
 * @param {object} canonicalAst
 * @param {object} selection
 * @param {string} selection.inputOperandId
 * @param {string} selection.outputOperandId
 * @returns {{ast: object, mapping: object, rebuilt: boolean}}
 */
function rebuildAst(canonicalAst, { inputOperandId, outputOperandId }) {
  const operandIds = collectOperandIds(canonicalAst);

  if (operandIds.length < 2) {
    throw new Error("AST must contain at least two operands.");
  }

  const mapping = buildOperandMapping(
    operandIds,
    inputOperandId,
    outputOperandId
  );

  const rebuilt = outputOperandId !== "O1";
  const ast = remapOperands(canonicalAst, mapping);

  return {
    ast,
    mapping: Object.fromEntries(mapping),
    rebuilt
  };
}

module.exports = {
  collectOperandIds,
  buildOperandMapping,
  remapOperands,
  rebuildAst
};
