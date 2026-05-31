function buildSequenceRng(values, fallback = 0.99) {
  const sequence = Array.isArray(values) ? [...values] : [];
  let index = 0;

  return () => {
    if (index < sequence.length) {
      const value = sequence[index];
      index += 1;
      return value;
    }

    return fallback;
  };
}

module.exports = {
  buildSequenceRng
};
