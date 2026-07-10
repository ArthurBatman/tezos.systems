const TEZOS_IMPLICIT_ADDRESS = /^tz[1-4][1-9A-HJ-NP-Za-km-z]{33}$/;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isImplicitAddress(value) {
  return TEZOS_IMPLICIT_ADDRESS.test(String(value || ''));
}

export function compareCodePoint(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

export function compareRanked(left, right, fields) {
  for (const field of fields) {
    const direction = field.direction === 'asc' ? 1 : -1;
    const leftValue = typeof field.value === 'function' ? field.value(left) : left[field.value];
    const rightValue = typeof field.value === 'function' ? field.value(right) : right[field.value];
    if (leftValue === rightValue) continue;
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      return compareCodePoint(leftValue || '', rightValue || '') * direction;
    }
    return (number(leftValue) - number(rightValue)) * direction;
  }
  return compareCodePoint(left.address || '', right.address || '');
}
