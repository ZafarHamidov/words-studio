/* ══════════════════════════════════════════
   api.js  —  All fetch() calls to the Flask backend
   ══════════════════════════════════════════ */
const Api = (() => {
  const BASE = '/api';

  async function _req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + path, opts);
    const contentType = r.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await r.json()
      : { error: await r.text() };
    if (!r.ok) throw data;
    return data;
  }

  const get  = (p)      => _req('GET',    p);
  const post = (p, b)   => _req('POST',   p, b);
  const put  = (p, b)   => _req('PUT',    p, b);
  const del  = (p)      => _req('DELETE', p);

  return {
    // ── Settings ──
    getSettings:  ()  => get('/settings'),
    saveSettings: (d) => put('/settings', d),

    // ── Stats ──
    getStats: () => get('/stats'),

    // ── Dictionary ──
    lookupWord: (word) => get(`/lookup/${encodeURIComponent(word)}`),

    // ── Dictionary ──
    lookupWiktionary: (word) => get(`/lookup-wiktionary/${encodeURIComponent(word)}`),
    lookupCambridge: (word) => get(`/lookup-cambridge/${encodeURIComponent(word)}`),
    lookupOxford: (word) => get(`/lookup-oxford/${encodeURIComponent(word)}`),

    // ── Decks ──
    getDecks:    ()          => get('/decks'),
    createDeck:  (d)         => post('/decks', d),
    deleteDeck:  (id)        => del(`/decks/${id}`),
    getDeckWords: (id, params) => {
      const qs = new URLSearchParams(params || {}).toString();
      return get(`/decks/${id}/words${qs ? '?' + qs : ''}`);
    },
    addWordsToDeck:     (id, words)   => post(`/decks/${id}/add-words`, { words }),
    addAllToDeck:       (id, filters) => post(`/decks/${id}/add-all`, filters || {}),
    removeWordsFromDeck:(id, cardIds) => post(`/decks/${id}/remove-words`, { card_ids: cardIds }),
    getLearningWords: (params) => {
      const qs = new URLSearchParams(params || {}).toString();
      return get(`/learning-words${qs ? '?' + qs : ''}`);
    },

    // ── Cards ──
    getDueCards: (params) => {
      const qs = new URLSearchParams(params || {}).toString();
      return get(`/cards/due${qs ? '?' + qs : ''}`);
    },
    createCard:   (d)   => post('/cards', d),
    updateCard:   (id, d) => put(`/cards/${id}`, d),
    deleteCard:   (id)  => del(`/cards/${id}`),
    removeCardsFromLearning: (cardIds) => post('/cards/remove-from-learning', { card_ids: cardIds }),
    permanentDeleteCards: (cardIds) => post('/cards/permanent-delete', { card_ids: cardIds }),
    reviewCard:   (id, button) => post(`/cards/${id}/review`, { button }),
    previewIntervals: (id) => get(`/cards/${id}/preview-intervals`),
    enrichCard:   (id)        => post(`/cards/${id}/enrich`, {}),
  };
})();
