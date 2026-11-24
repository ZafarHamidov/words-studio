/* GitHub Pages storage adapter. Edit when browser persistence or API behavior changes. */
const Api = (() => {
  const DB_NAME = 'words-studio-pages-v1';
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const clone = value => structuredClone(value);
  const fail = error => { throw { error }; };
  const day = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const laterDay = days => { const date = new Date(); date.setDate(date.getDate() + days); return day(date); };
  let catalog, db;

  function transaction(change) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('state');
      let result;
      const request = store.get('main');
      request.onsuccess = () => {
        try {
          const state = request.result;
          result = change ? change(state, store) : state;
          if (change && state) store.put(state, 'main');
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject({ error: 'Could not save study data. Check browser storage space.' });
      tx.onabort = () => reject({ error: 'Could not save study data.' });
    });
  }

  function reset(card) {
    return Object.assign(card, { is_learning: 1, ease_factor: 2.5, interval: 0,
      phase: 'new', steps_index: 0, due_datetime: new Date().toISOString(), due_date: day(),
      last_reviewed: null, total_reviews: 0, correct_reviews: 0, show_definition_first: false });
  }

  function newCard(entry, deckId, id) {
    const academic = catalog.academic.find(item => item.word.toLowerCase() === entry.word.toLowerCase());
    const source = { ...academic, ...entry };
    return reset({ id, word: source.word.trim(), deck_id: Number(deckId),
      phonetic: source.phonetic || '', audio_url: source.audio_url || '',
      definition_data: clone(source.definition_data || null), collocations: source.collocations || [],
      notes: source.notes ?? source.hint ?? '', register: source.register || '', created_at: new Date().toISOString() });
  }

  const ready = (async () => {
    const names = ['sat_words', 'freq_words', 'academic_words', 'cefr'];
    const values = await Promise.all(names.map(async name => {
      const response = await fetch(`./data/${name}.json`);
      if (!response.ok) fail('Could not load word lists. Refresh to try again.');
      return response.json();
    }));
    catalog = { 1: values[0], 2: values[1], academic: values[2], cefr: values[3] };
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject({ error: 'Browser storage is unavailable. Enable site storage to study.' });
    });
    await transaction((state, store) => {
      if (state) return;
      const initial = { version: 1, nextCard: 571, nextDeck: 9, reviews: [],
        settings: { daily_goal: '20', theme: 'dark', audio_enabled: 'true', cefr_filter_mode: 'all', cefr_filter_level: 'B2' },
        decks: [
          { id: 1, name: 'SAT Words', description: '650 essential SAT vocabulary words', is_builtin: 1 },
          { id: 2, name: '5000 Most Common', description: 'Top 5000 English words by corpus frequency', is_builtin: 1 },
          { id: 7, name: 'My Words', description: 'Your personal word collection', is_builtin: 0 },
          { id: 8, name: 'Academic Word List (570 words)', description: '570 academic words with dictionary example sentences', is_builtin: 0 },
        ], cards: catalog.academic.map((entry, index) => newCard(entry, 8, index + 1)) };
      store.put(initial, 'main');
    });
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  })();
  // App methods still receive initialization errors; avoid an early unhandled rejection.
  ready.catch(() => {});
  const read = async () => { await ready; return transaction(); };
  const write = async fn => { await ready; return transaction(fn); };
  const getCard = (state, id) => state.cards.find(card => card.id === Number(id)) || fail('not found');
  const getDeck = (state, id) => state.decks.find(deck => deck.id === Number(id)) || fail('not found');
  const cefr = word => catalog.cefr[word.toLowerCase()] || '';
  const phaseStage = phase => ({ new: 'to_learn', learning: 'practiced', review: 'learned' }[phase] || 'inactive');
  const isDue = card => card.is_learning && (card.phase === 'learning'
    ? new Date(card.due_datetime).getTime() <= Date.now() : card.due_date <= day());

  function matches(row, params = {}) {
    const search = (params.search || '').trim().toLowerCase();
    if (search && ![row.word, row.hint, row.notes, row.deck_name].join(' ').toLowerCase().includes(search)) return false;
    const filter = params.filter || params.phase || 'all';
    if (filter === 'added' && !row.is_learning) return false;
    if (['inactive', 'unlearned', 'not_added'].includes(filter) && row.is_learning) return false;
    const phases = { to_learn: 'new', practiced: 'learning', learned: 'review' };
    if ([...Object.keys(phases), 'new', 'learning', 'review'].includes(filter) && row.phase !== (phases[filter] || filter)) return false;
    const mode = params.cefr_mode || 'all';
    const target = params.cefr_level || '';
    const level = row.cefr_level;
    if (mode === 'unknown') return !level;
    if (mode === 'all') return true;
    if (!level || !levels.includes(target)) return false;
    if (mode === 'exact') return level === target;
    if (mode === 'lte') return levels.indexOf(level) <= levels.indexOf(target);
    if (mode === 'gte') return levels.indexOf(level) >= levels.indexOf(target);
    return true;
  }

  function wordRows(state, deckId, params = {}) {
    const deck = getDeck(state, deckId);
    const cards = state.cards.filter(card => card.deck_id === deck.id);
    const map = new Map(cards.map(card => [card.word.toLowerCase(), card]));
    const entries = deck.is_builtin ? catalog[deck.id] || [] : cards;
    return entries.map(entry => {
      const card = map.get(entry.word.toLowerCase());
      const active = !!card?.is_learning;
      return { word: entry.word, pos: entry.pos || '', hint: entry.hint || entry.notes || '',
        notes: card?.notes || entry.hint || '', is_added: active, is_learning: active,
        card_id: card?.id ?? null, phase: active ? card.phase : null,
        stage: active ? phaseStage(card.phase) : 'inactive', phonetic: card?.phonetic || '',
        cefr_level: cefr(entry.word), deck_id: deck.id, deck_name: deck.name, is_builtin: !!deck.is_builtin };
    }).filter(row => matches(row, params));
  }

  function intervalLabel(days) {
    if (days <= 0) return '<1m';
    if (days === 1) return '1d';
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${Math.round(days / 365 * 10) / 10}yr`;
  }

  function preview(card) {
    if (card.phase === 'new' || card.phase === 'learning') return {
      again: '<1m', hard: '<1m', good: card.steps_index + 1 >= 2 ? '1d' : '10m', easy: '4d' };
    return { again: '<1m', hard: intervalLabel(Math.max(1, Math.round(card.interval * 1.2))),
      good: intervalLabel(Math.max(1, Math.round(card.interval * card.ease_factor))),
      easy: intervalLabel(Math.max(1, Math.round(card.interval * card.ease_factor * 1.3))) };
  }

  async function lookupWord(word) {
    await ready;
    const saved = catalog.academic.find(entry => entry.word.toLowerCase() === word.trim().toLowerCase() && entry.dictionary_source === 'freedict');
    if (saved) return { word: saved.word, phonetic: saved.phonetic, phonetics: [], audio_url: saved.audio_url,
      meanings: clone(saved.definition_data.meanings), source: 'freedict', register: '' };
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim().toLowerCase())}`, { signal: AbortSignal.timeout(15000) });
      if (response.status === 404) fail('not_found');
      if (!response.ok) fail('api_unavailable');
      const entries = await response.json();
      const entry = entries[0];
      return { word: entry.word, phonetic: entry.phonetic || entry.phonetics?.find(item => item.text)?.text || '',
        phonetics: entry.phonetics || [], audio_url: entry.phonetics?.find(item => item.audio)?.audio || '',
        meanings: entries.flatMap(item => item.meanings || []), source: 'freedict', register: '' };
    } catch (error) { if (error.error) throw error; fail('api_unavailable'); }
  }

  function addWords(state, deckId, words) {
    const deck = getDeck(state, deckId);
    let added = 0;
    for (const raw of words) {
      const word = String(raw).trim();
      if (!word) continue;
      const existing = state.cards.find(card => card.deck_id === deck.id && card.word.toLowerCase() === word.toLowerCase());
      if (existing) { if (!existing.is_learning) { reset(existing); added++; } continue; }
      const entry = (catalog[deck.id] || []).find(item => item.word.toLowerCase() === word.toLowerCase()) || { word };
      state.cards.push(newCard(entry, deck.id, state.nextCard++));
      added++;
    }
    return { added, failed: [], already_had: words.length - added };
  }

  const api = {
    getSettings: async () => (await read()).settings,
    saveSettings: data => write(state => { Object.assign(state.settings, data); return { ok: true }; }),
    getStats: async () => {
      const state = await read();
      const active = state.cards.filter(card => card.is_learning);
      const dates = new Set(state.reviews.map(review => review.date));
      let streak = 0;
      let offset = dates.has(day()) ? 0 : -1;
      while (dates.has(laterDay(offset))) { streak++; offset--; }
      return { streak, reviewed_today: state.reviews.filter(review => review.date === day() && review.button !== 'again').length,
        daily_goal: Number(state.settings.daily_goal), total_cards: active.length,
        total_revised: active.filter(card => card.phase !== 'new').length,
        total_learned: active.filter(card => card.phase === 'review').length, due_now: active.filter(isDue).length,
        upcoming_7d: Array.from({ length: 7 }, (_, i) => ({ date: laterDay(i), count: active.filter(card => card.phase === 'review' && card.due_date === laterDay(i)).length })) };
    },
    lookupWord,
    lookupWiktionary: async () => fail('api_unavailable'),
    lookupOxford: async () => fail('api_unavailable'),
    lookupCambridge: async word => {
      await ready;
      const entry = catalog.academic.find(item => item.word.toLowerCase() === word.toLowerCase() && item.dictionary_source === 'cambridge');
      if (!entry) fail('api_unavailable');
      return { ...clone(entry.definition_data), word: entry.word, phonetic: entry.phonetic, audio_url: entry.audio_url, phonetics: [] };
    },
    getDecks: async () => {
      const state = await read();
      return { decks: state.decks.map(deck => {
        const cards = state.cards.filter(card => card.deck_id === deck.id && card.is_learning);
        const total = deck.is_builtin ? catalog[deck.id].length : state.cards.filter(card => card.deck_id === deck.id).length;
        const revised = cards.filter(card => card.phase !== 'new').length;
        return { ...deck, total_words: total, revised_count: revised, learned_count: cards.filter(card => card.phase === 'review').length,
          due_count: cards.filter(isDue).length, progress_pct: total ? Math.round(revised / total * 1000) / 10 : 0 };
      }) };
    },
    createDeck: data => write(state => {
      if (!data.name?.trim()) fail('name is required');
      const deck = { id: state.nextDeck++, name: data.name.trim().slice(0, 60), description: data.description || '', is_builtin: 0 };
      state.decks.push(deck); return deck;
    }),
    deleteDeck: id => write(state => {
      if (getDeck(state, id).is_builtin) fail('Cannot delete built-in decks');
      state.decks = state.decks.filter(deck => deck.id !== Number(id));
      state.cards = state.cards.filter(card => card.deck_id !== Number(id));
      return { ok: true };
    }),
    getDeckWords: async (id, params = {}) => {
      const rows = wordRows(await read(), id, params);
      const page = Math.max(1, Number(params.page) || 1), perPage = Math.min(5000, Number(params.per_page) || 50);
      return { words: params.all ? rows : rows.slice((page - 1) * perPage, page * perPage), total: rows.length, page, per_page: perPage };
    },
    addWordsToDeck: (id, words) => write(state => addWords(state, id, words)),
    addAllToDeck: (id, params = {}) => write(state => addWords(state, id, wordRows(state, id, params).map(row => row.word))),
    removeWordsFromDeck: (id, cardIds) => write(state => {
      let removed = 0;
      for (const card of state.cards) if (card.deck_id === Number(id) && cardIds.includes(card.id) && card.is_learning) { card.is_learning = 0; removed++; }
      return { removed };
    }),
    getLearningWords: async (params = {}) => {
      const state = await read();
      const words = state.decks.filter(deck => !params.deck_id || Number(params.deck_id) === deck.id)
        .flatMap(deck => wordRows(state, deck.id, params)).filter(row => row.is_learning);
      return { words, total: words.length };
    },
    getDueCards: async (params = {}) => {
      const state = await read();
      const cards = state.cards.filter(card => isDue(card) && (!params.deck_id || card.deck_id === Number(params.deck_id)))
        .sort((a, b) => ['learning', 'review', 'new'].indexOf(a.phase) - ['learning', 'review', 'new'].indexOf(b.phase) || a.due_datetime.localeCompare(b.due_datetime));
      return { cards: cards.slice(0, Number(params.limit) || 9999).map(card => ({ ...card,
        deck_name: getDeck(state, card.deck_id).name, cefr_level: cefr(card.word),
        show_definition_first: Math.random() < 0.3 && !!(card.definition_data?.meanings?.length || card.notes), preview_intervals: preview(card) })), total_due: cards.length };
    },
    createCard: data => write(state => {
      if (!data.word?.trim()) fail('word is required');
      const deckId = data.deck_id ? Number(data.deck_id) : 7;
      getDeck(state, deckId);
      const existing = state.cards.find(card => card.deck_id === deckId && card.word.toLowerCase() === data.word.trim().toLowerCase());
      if (existing) { if (existing.is_learning) fail('already_exists'); reset(existing); return { id: existing.id, word: existing.word, reactivated: true }; }
      const card = newCard(data, deckId, state.nextCard++); state.cards.push(card);
      return { id: card.id, word: card.word };
    }),
    updateCard: (id, data) => write(state => {
      const card = getCard(state, id);
      for (const key of ['notes', 'register', 'phonetic', 'audio_url', 'definition_data', 'collocations']) if (key in data) card[key] = clone(data[key]);
      return card;
    }),
    deleteCard: id => write(state => { getCard(state, id); state.cards = state.cards.filter(card => card.id !== Number(id)); return { ok: true }; }),
    removeCardsFromLearning: ids => write(state => {
      let removed = 0;
      for (const card of state.cards) if (ids.includes(card.id) && card.is_learning) { card.is_learning = 0; removed++; }
      return { removed };
    }),
    permanentDeleteCards: ids => write(state => {
      let deleted = 0, skipped_builtin = 0;
      state.cards = state.cards.filter(card => {
        if (!ids.includes(card.id)) return true;
        if (getDeck(state, card.deck_id).is_builtin) { skipped_builtin++; return true; }
        deleted++; return false;
      });
      return { deleted, skipped_builtin };
    }),
    reviewCard: (id, button) => write(state => {
      if (!['again', 'hard', 'good', 'easy'].includes(button)) fail('invalid button');
      const card = getCard(state, id);
      if (!card.is_learning) fail('not found');
      let minutes = 0, days = 0;
      if (['new', 'learning'].includes(card.phase)) {
        if (button === 'again') { card.phase = 'learning'; card.steps_index = 0; minutes = 1; }
        else if (button === 'easy') { card.phase = 'review'; card.steps_index = 0; days = 4; }
        else {
          card.steps_index += button === 'good' ? 1 : 0;
          if (card.steps_index >= 2) { card.phase = 'review'; card.steps_index = 0; days = 1; }
          else { card.phase = 'learning'; minutes = [1, 10][card.steps_index]; }
        }
        card.interval = days;
      } else if (button === 'again') {
        card.ease_factor = Math.max(1.3, card.ease_factor - 0.2); card.phase = 'learning'; card.steps_index = 0; minutes = 1;
      } else {
        const multiplier = button === 'hard' ? 1.2 : card.ease_factor * (button === 'easy' ? 1.3 : 1);
        days = Math.max(1, Math.min(36500, Math.round(card.interval * multiplier))); card.interval = days;
        if (button === 'hard') card.ease_factor = Math.max(1.3, card.ease_factor - 0.15);
        if (button === 'easy') card.ease_factor = Math.min(9.9, card.ease_factor + 0.15);
      }
      card.ease_factor = Math.round(card.ease_factor * 100) / 100;
      card.due_date = laterDay(days); card.due_datetime = new Date(Date.now() + (minutes * 60 + days * 86400) * 1000).toISOString();
      card.last_reviewed = new Date().toISOString(); card.total_reviews++; card.correct_reviews += button !== 'again' ? 1 : 0;
      state.reviews.push({ card_id: card.id, button, date: day(), reviewed_at: card.last_reviewed });
      return { new_interval: card.interval, new_ease_factor: card.ease_factor, new_phase: card.phase,
        new_due_date: card.due_date, display_next: minutes ? (minutes === 1 ? '<1m' : `${minutes}m`) : intervalLabel(days), is_correct: button !== 'again' };
    }),
    previewIntervals: async id => preview(getCard(await read(), id)),
    enrichCard: async id => {
      const card = getCard(await read(), id);
      if (card.definition_data) return card;
      const data = await lookupWord(card.word);
      return write(state => {
        const current = getCard(state, id);
        if (!current.definition_data) Object.assign(current, { definition_data: { meanings: data.meanings, source: data.source },
          phonetic: data.phonetic || current.phonetic, audio_url: data.audio_url || current.audio_url });
        return current;
      });
    },
    exportProgress: async () => ({ format: 'words-studio-progress', version: 1, exported_at: new Date().toISOString(), state: await read() }),
    importProgress: async backup => {
      const state = clone(backup?.state);
      if (backup?.format !== 'words-studio-progress' || backup.version !== 1 || !state || !Array.isArray(state.cards) || !Array.isArray(state.decks) || !Array.isArray(state.reviews) || !state.settings) fail('Invalid Words Studio backup.');
      if (state.cards.length > 50000 || state.decks.length > 1000) fail('Backup is too large.');
      const deckIds = new Set();
      for (const deck of state.decks) {
        if (!Number.isSafeInteger(deck.id) || deckIds.has(deck.id) || typeof deck.name !== 'string' || (deck.is_builtin && ![1, 2].includes(deck.id))) fail('Invalid deck in backup.');
        deckIds.add(deck.id);
      }
      if (!deckIds.has(7)) fail('Backup is missing My Words.');
      const ids = new Set();
      for (const card of state.cards) {
        if (!Number.isSafeInteger(card.id) || ids.has(card.id) || typeof card.word !== 'string' || !deckIds.has(card.deck_id) || !['new', 'learning', 'review'].includes(card.phase) || !Number.isFinite(card.ease_factor) || !Number.isFinite(card.interval) || !Number.isInteger(card.steps_index) || card.steps_index < 0 || card.steps_index > 1 || !Number.isFinite(new Date(card.due_datetime).getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(card.due_date)) fail('Invalid card in backup.');
        ids.add(card.id);
      }
      state.nextCard = Math.max(0, ...ids) + 1; state.nextDeck = Math.max(8, ...deckIds) + 1;
      await write((current, store) => { Object.keys(current).forEach(key => delete current[key]); Object.assign(current, state); });
      return { imported: state.cards.length };
    },
  };
  return api;
})();
