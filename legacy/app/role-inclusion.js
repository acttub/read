export function getInitialRoleInclusion(turns, roles) {
  const lineCounts = new Map(
    roles.map((role) => [
      role,
      turns.filter((turn) => turn.role === role && !turn.isDirection).length,
    ]),
  );
  const selectedRole =
    roles.find((role) => lineCounts.get(role) >= 2) || roles[0] || "";
  const includedRoles = new Set(
    roles.filter((role) => lineCounts.get(role) >= 2),
  );
  if (selectedRole) includedRoles.add(selectedRole);

  return { lineCounts, selectedRole, includedRoles };
}

export function partitionRolesByInitialInclusion(roles, includedRoles) {
  const included = [];
  const excluded = [];

  for (const role of roles) {
    (includedRoles.has(role) ? included : excluded).push(role);
  }

  return { included, excluded };
}

export function filterTurnsByRoleParams(turns, roleParams) {
  if (Object.keys(roleParams).length === 0) return turns;

  return turns.filter((turn) =>
    Object.prototype.hasOwnProperty.call(roleParams, turn.role),
  );
}
