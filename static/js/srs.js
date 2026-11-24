/* ══════════════════════════════════════════
   srs.js  —  In-memory card queue & session tracking
   ══════════════════════════════════════════ */
const SRS = (() => {
  let _queue = [];
  let _reviewed = 0;
  let _again = 0;

  function load(cards, options = {}) {
    const { resetStats = true } = options;
    _queue = [...cards];
    if (resetStats) {
      _reviewed = 0;
      _again = 0;
    }
  }

  function merge(cards) {
    const existing = new Set(_queue.map(card => card.id));
    cards.forEach((card) => {
      if (!existing.has(card.id)) {
        _queue.push(card);
        existing.add(card.id);
      }
    });
  }

  function current() {
    return _queue[0] || null;
  }

  function size() {
    return _queue.length;
  }

  function afterReview(cardId, isCorrect) {
    if (isCorrect) {
      _queue = _queue.filter(c => c.id !== cardId);
      _reviewed++;
    } else {
      const idx = _queue.findIndex(c => c.id === cardId);
      if (idx === -1) return;
      const card = _queue.splice(idx, 1)[0];
      const insertAt = Math.min(_queue.length, Math.max(3, Math.floor(_queue.length * 0.6)));
      _queue.splice(insertAt, 0, card);
      _again++;
    }
  }

  function remove(cardIds) {
    const ids = new Set(Array.isArray(cardIds) ? cardIds : [cardIds]);
    _queue = _queue.filter(card => !ids.has(card.id));
  }

  function sessionStats() {
    return {
      reviewed: _reviewed,
      again: _again,
      remaining: _queue.length,
      correct: _reviewed,
      wrong: _again,
    };
  }

  function reset() {
    _queue = [];
    _reviewed = 0;
    _again = 0;
  }

  return { load, merge, current, size, afterReview, remove, sessionStats, reset };
})();
