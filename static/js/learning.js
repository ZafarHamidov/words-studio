/* Learning queue UI plus cross-deck learning-word manager */
const Learning = (() => {
  const S = {
    IDLE: 'IDLE',
    LOADING: 'LOADING',
    FRONT: 'FRONT',
    BACK: 'BACK',
    TRANSITIONING: 'TRANSITIONING',
    EDITING: 'EDITING',
    EMPTY: 'EMPTY',
  };
  let state = S.IDLE;

  const $ = (id) => document.getElementById(id);
  const cardScene = $('card-scene');
  const reviewBtns = $('review-buttons');
  const emptyState = $('empty-state');
  const editOverlay = $('edit-overlay');
  const cardFront = $('card-front');

  let touchStartX = 0;
  let touchStartY = 0;
  let learningRows = [];
  let learningSelection = new Map();
  let learningSearchTimer = null;
  let activeAudio = null;

  function setState(nextState) {
    state = nextState;
  }

  function _escapeHtml(value) {
    const safeValue = value === undefined || value === null ? '' : value;
    return String(safeValue).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function _selectionKey(row) {
    return String(row.card_id);
  }

  function _selectedLearningRows() {
    return [...learningSelection.values()];
  }

  function _stageMeta(phase) {
    if (phase === 'review') {
      return { label: 'Learned', className: 'status-learned' };
    }
    if (phase === 'learning') {
      return { label: 'Practiced', className: 'status-practiced' };
    }
    return { label: 'To Learn', className: 'status-added' };
  }

  async function startSession() {
    setState(S.LOADING);
    _showLoading();
    await syncDueQueue({ replace: true, resetStats: true });
  }

  async function syncDueQueue(options = {}) {
    const { replace = false, resetStats = false } = options;
    try {
      const { cards, total_due } = await Api.getDueCards({ limit: 9999 });
      if (!cards || cards.length === 0) {
        if (replace) {
          SRS.load([], { resetStats });
        }
        _updateSessionBar();
        if (SRS.size() === 0) {
          setState(S.EMPTY);
          _showEmpty(total_due);
        }
        return 0;
      }

      if (replace || SRS.size() === 0) {
        SRS.load(cards, { resetStats });
      } else {
        SRS.merge(cards);
      }

      _updateSessionBar();
      if (replace || state === S.EMPTY || state === S.IDLE || state === S.LOADING || !SRS.current()) {
        showCard();
      }
      return cards.length;
    } catch (e) {
      console.error(e);
      Toast.show('Could not load cards. Is the server running?', 'error');
      setState(S.IDLE);
      return 0;
    }
  }

  function dropCards(cardIds) {
    SRS.remove(cardIds);
    _updateSessionBar();
    if (SRS.size() === 0) {
      setState(S.EMPTY);
      _showEmpty(0);
      return;
    }
    const current = SRS.current();
    if (current && state !== S.TRANSITIONING && state !== S.EDITING) {
      showCard();
    }
  }

  function showCard() {
    const card = SRS.current();
    if (!card) {
      setState(S.EMPTY);
      _showEmpty(0);
      return;
    }
    setState(S.FRONT);

    $('card-loading-indicator').hidden = true;
    cardFront.querySelector('.card-front-badges').style.display = '';
    cardFront.querySelector('.card-front-body').style.display = '';

    cardScene.classList.remove('flipped');
    editOverlay.hidden = true;

    reviewBtns.hidden = true;
    emptyState.hidden = true;
    cardScene.style.display = '';

    const frontText = card.show_definition_first ? _getFirstDefinition(card) : card.word;
    $('card-word').textContent = frontText;
    _applyTextDensity($('card-word'), frontText, card.show_definition_first);
    $('card-phonetic').textContent = card.show_definition_first ? 'What is the word?' : (card.phonetic || '');
    $('btn-play-audio-front').hidden = !!card.show_definition_first;

    const deckBadge = $('card-deck-badge');
    deckBadge.textContent = card.deck_name || '';
    deckBadge.style.display = card.deck_name ? '' : 'none';

    const frontCefr = $('cefr-badge-front');
    frontCefr.textContent = card.cefr_level || '';
    frontCefr.style.display = card.cefr_level ? '' : 'none';

    _setPhaseBadge('phase-badge-front', card.phase);
    _renderBack(card);
    _updateSessionBar();
  }

  function flip() {
    if (state !== S.FRONT) return;
    setState(S.BACK);
    cardScene.classList.add('flipped');
    setTimeout(() => {
      reviewBtns.hidden = false;
      _updateIntervalLabels();
    }, 300);
  }

  function unflip() {
    if (state !== S.BACK) return;
    setState(S.FRONT);
    cardScene.classList.remove('flipped');
    reviewBtns.hidden = true;
  }

  async function submitReview(button) {
    if (state !== S.BACK) return;
    setState(S.TRANSITIONING);

    const card = SRS.current();
    const isCorrect = button !== 'again';
    cardScene.classList.add(isCorrect ? 'card-swipe-right' : 'card-swipe-left');
    reviewBtns.hidden = true;

    try {
      const result = await Api.reviewCard(card.id, button);
      SRS.afterReview(card.id, result.is_correct);
      if (result.is_correct) App.onCardReviewed();
    } catch (e) {
      console.error('Review error:', e);
      cardScene.classList.remove('card-swipe-left', 'card-swipe-right');
      reviewBtns.hidden = false;
      setState(S.BACK);
      Toast.show('Could not save that review', 'error');
      return;
    }

    setTimeout(async () => {
      cardScene.classList.remove('card-swipe-left', 'card-swipe-right');
      if (SRS.size() === 0) {
        await syncDueQueue({ replace: true, resetStats: false });
        if (SRS.size() === 0) {
          setState(S.EMPTY);
          _showEmpty(0);
        }
      } else {
        showCard();
      }
    }, 380);
  }

  function startEdit() {
    if (state !== S.BACK) return;
    const card = SRS.current();
    if (!card) return;
    setState(S.EDITING);

    const colls = Array.isArray(card.collocations) ? card.collocations.join(', ') : (card.collocations || '');
    $('edit-register').value = card.register || '';
    $('edit-collocations').value = colls;
    $('edit-notes').value = card.notes || '';
    editOverlay.hidden = false;
  }

  async function saveEdit() {
    const card = SRS.current();
    if (!card) return;
    const colls = $('edit-collocations').value.split(',').map(s => s.trim()).filter(Boolean);
    try {
      const updated = await Api.updateCard(card.id, {
        register: $('edit-register').value,
        collocations: colls,
        notes: $('edit-notes').value,
      });
      Object.assign(card, {
        register: updated.register,
        collocations: Array.isArray(updated.collocations)
          ? updated.collocations
          : JSON.parse(updated.collocations || '[]'),
        notes: updated.notes,
        cefr_level: updated.cefr_level || card.cefr_level,
      });
      _renderBack(card);
      Toast.show('Card updated', 'success');
    } catch (e) {
      Toast.show('Could not save changes', 'error');
    }
    editOverlay.hidden = true;
    setState(S.BACK);
  }

  function cancelEdit() {
    editOverlay.hidden = true;
    setState(S.BACK);
  }

  function _playCardAudio() {
    const card = SRS.current();
    if (!card || !(card.word || '').trim()) return;

    try {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
    } catch (e) {
      /* ignore */
    }

    if (card.audio_url) {
      activeAudio = new Audio(card.audio_url);
      activeAudio.play().catch(() => _speakWord(card.word));
      return;
    }
    _speakWord(card.word);
  }

  function _speakWord(word) {
    if (!('speechSynthesis' in window) || !word) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }

  function _renderBack(card) {
    const cardIsDefFirst = card.show_definition_first;
    const backText = cardIsDefFirst ? _getFirstDefinition(card) : card.word;
    $('back-word').textContent = backText;
    _applyTextDensity($('back-word'), backText, cardIsDefFirst);
    $('back-phonetic').textContent = cardIsDefFirst ? '' : (card.phonetic || '');

    const defSection = $('definition-section');
    defSection.innerHTML = '';
    const meanings = card.definition_data?.meanings || [];

    if (cardIsDefFirst) {
      const answerEl = document.createElement('div');
      answerEl.className = 'def-entry';
      answerEl.innerHTML = `<div class="card-back-word answer-word">${_escapeHtml(card.word)}</div>`;
      defSection.appendChild(answerEl);
    }

    meanings.forEach(m => {
      const el = document.createElement('div');
      el.className = 'def-entry';
      el.innerHTML = `<div class="def-pos">${_escapeHtml(m.partOfSpeech || '')}</div>`;
      (m.definitions || []).slice(0, 2).forEach(d => {
        el.innerHTML += `<div class="def-text">${_escapeHtml(d.definition || '')}</div>`;
        if (d.example) el.innerHTML += `<div class="def-example">${_escapeHtml(d.example)}</div>`;
      });
      defSection.appendChild(el);
    });

    if (!meanings.length && card.notes) {
      const noteEl = document.createElement('div');
      noteEl.className = 'def-entry';
      noteEl.innerHTML = `<div class="def-text">${_escapeHtml(card.notes)}</div>`;
      defSection.appendChild(noteEl);
    }

    $('examples-section').innerHTML = '';

    const cefrBadge = $('cefr-badge');
    cefrBadge.textContent = card.cefr_level || '';
    cefrBadge.style.display = card.cefr_level ? '' : 'none';

    const regBadge = $('register-badge');
    regBadge.className = 'register-badge';
    if (card.register) {
      regBadge.textContent = card.register;
      regBadge.classList.add(`reg-${card.register}`);
    } else {
      regBadge.textContent = '';
    }

    const collWrap = $('collocations-wrap');
    collWrap.innerHTML = '';
    const colls = Array.isArray(card.collocations) ? card.collocations : [];
    if (colls.length) {
      const label = document.createElement('span');
      label.className = 'collocation-tag';
      label.style.background = 'transparent';
      label.style.color = 'var(--text-muted)';
      label.textContent = 'Common phrases:';
      collWrap.appendChild(label);
      colls.slice(0, 6).forEach((collocation) => {
        const tag = document.createElement('span');
        tag.className = 'collocation-tag';
        tag.textContent = collocation;
        collWrap.appendChild(tag);
      });
    }

    const notesEl = $('notes-section');
    if (card.notes) {
      notesEl.textContent = card.notes;
      notesEl.style.display = '';
    } else {
      notesEl.style.display = 'none';
    }

    if (!card.definition_data && !card._enriching) {
      card._enriching = true;
      Api.enrichCard(card.id).then((enriched) => {
        if (enriched?.definition_data && SRS.current()?.id === card.id) {
          card.definition_data = enriched.definition_data;
          if (enriched.phonetic) card.phonetic = enriched.phonetic;
          if (enriched.audio_url) card.audio_url = enriched.audio_url;
          _renderBack(card);
        }
        card._enriching = false;
      }).catch(() => {
        card._enriching = false;
      });
    }
  }

  function _getFirstDefinition(card) {
    const meanings = card.definition_data?.meanings || [];
    if (meanings[0]?.definitions?.[0]?.definition) {
      const pos = meanings[0].partOfSpeech ? `[${meanings[0].partOfSpeech}] ` : '';
      return pos + meanings[0].definitions[0].definition;
    }
    return (card.notes || '').trim() || card.word;
  }

  function _setPhaseBadge(id, phase) {
    const el = $(id);
    el.className = 'card-phase-badge';
    if (phase === 'new') {
      el.textContent = 'To Learn';
      el.classList.add('phase-new');
    } else if (phase === 'learning') {
      el.textContent = 'Practiced';
      el.classList.add('phase-learning');
    } else if (phase === 'review') {
      el.textContent = 'Learned';
      el.classList.add('phase-review');
    } else {
      el.textContent = '';
    }
  }

  function _applyTextDensity(el, text, isDefinition) {
    if (!el) return;
    const len = (text || '').trim().length;
    el.dataset.definition = isDefinition ? 'true' : 'false';
    el.dataset.density = len > 150 ? 'dense' : (len > 78 ? 'compact' : 'normal');
  }

  function _updateIntervalLabels() {
    const card = SRS.current();
    if (!card?.preview_intervals) return;
    const pi = card.preview_intervals;
    $('int-again').textContent = pi.again || '-';
    $('int-hard').textContent = pi.hard || '-';
    $('int-good').textContent = pi.good || '-';
    $('int-easy').textContent = pi.easy || '-';
  }

  function _updateSessionBar() {
    const stats = SRS.sessionStats();
    $('cards-left').textContent = SRS.size();
    $('session-correct').textContent = stats.reviewed;
    $('session-wrong').textContent = stats.again;
  }

  function _showLoading() {
    cardScene.style.display = '';
    emptyState.hidden = true;
    reviewBtns.hidden = true;
    cardFront.querySelector('.card-front-badges').style.display = 'none';
    cardFront.querySelector('.card-front-body').style.display = 'none';
    $('card-loading-indicator').hidden = false;
  }

  function _showEmpty(totalDue) {
    cardScene.style.display = 'none';
    reviewBtns.hidden = true;
    emptyState.hidden = false;
    $('empty-sub').textContent = totalDue > 0
      ? `You have ${totalDue} cards due, but none right now.`
      : 'No cards due right now. Add words or come back later.';
  }

  async function _loadLearningDeckOptions() {
    const { decks } = await Api.getDecks();
    const select = $('learning-deck-filter');
    const current = select.value;
    select.innerHTML = '<option value="">All Decks</option>';
    decks.forEach((deck) => {
      const option = document.createElement('option');
      option.value = String(deck.id);
      option.textContent = deck.name;
      select.appendChild(option);
    });
    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    }
  }

  async function openLearningWordsPanel() {
    $('learning-word-panel').hidden = false;
    $('learning-word-list').innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Loading...</div>';
    learningSelection.clear();
    try {
      await _loadLearningDeckOptions();
      const settings = await Api.getSettings();
      $('learning-cefr-mode').value = settings.cefr_filter_mode || $('learning-cefr-mode').value;
      $('learning-cefr-level').value = settings.cefr_filter_level || $('learning-cefr-level').value;
    } catch (e) {
      /* keep defaults */
    }
    await loadLearningWords();
  }

  function closeLearningWordsPanel() {
    $('learning-word-panel').hidden = true;
    learningRows = [];
    learningSelection.clear();
  }

  async function loadLearningWords() {
    try {
      const params = {
        deck_id: $('learning-deck-filter').value,
        phase: $('learning-phase-filter').value,
        cefr_mode: $('learning-cefr-mode').value,
        cefr_level: $('learning-cefr-level').value,
      };
      const search = $('learning-word-search').value.trim();
      if (search) params.search = search;
      const data = await Api.getLearningWords(params);
      learningRows = data.words || [];
      learningSelection.clear();
      const counts = {
        toLearn: learningRows.filter((row) => row.stage === 'to_learn' || row.phase === 'new').length,
        practiced: learningRows.filter((row) => row.stage === 'practiced' || row.phase === 'learning').length,
        learned: learningRows.filter((row) => row.stage === 'learned' || row.phase === 'review').length,
      };
      $('learning-panel-summary').textContent =
        `${data.total || learningRows.length} active cards | ${counts.toLearn} to learn | ${counts.practiced} practiced | ${counts.learned} learned`;
      _renderLearningWordList(learningRows);
      Api.saveSettings({
        cefr_filter_mode: $('learning-cefr-mode').value,
        cefr_filter_level: $('learning-cefr-level').value,
      }).catch(() => {});
    } catch (e) {
      console.error(e);
      $('learning-word-list').innerHTML = '<div style="padding:20px;color:var(--red)">Failed to load learning words.</div>';
      _updateLearningSelectionUI();
    }
  }

  function _renderLearningWordList(rows) {
    const list = $('learning-word-list');
    if (!rows.length) {
      list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No active learning words found.</div>';
      _updateLearningSelectionUI();
      return;
    }

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const stage = _stageMeta(row.phase);
      const selected = learningSelection.has(_selectionKey(row));

      const item = document.createElement('div');
      item.className = 'word-item';
      item.innerHTML = `
        <input type="checkbox" ${selected ? 'checked' : ''}>
        <div class="word-item-main">
          <div class="word-item-top">
            <span class="word-item-word">${_escapeHtml(row.word)}</span>
            <span class="word-item-pos">${_escapeHtml(row.deck_name)}</span>
            ${row.cefr_level ? `<span class="word-item-cefr">${_escapeHtml(row.cefr_level)}</span>` : ''}
          </div>
          <div class="word-item-hint">${_escapeHtml(row.notes || '')}</div>
        </div>
        <span class="word-item-status ${stage.className}">${stage.label}</span>`;

      item.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
        const key = _selectionKey(row);
        if (e.target.checked) learningSelection.set(key, row);
        else learningSelection.delete(key);
        _updateLearningSelectionUI();
        _updateLearningSelectAll();
      });
      fragment.appendChild(item);
    });

    list.appendChild(fragment);
    _updateLearningSelectionUI();
    _updateLearningSelectAll();
  }

  function _toggleLearningSelectAll() {
    const cb = $('cb-learning-select-all');
    if (cb.checked) learningRows.forEach((row) => learningSelection.set(_selectionKey(row), row));
    else learningSelection.clear();

    $('learning-word-list').querySelectorAll('input[type=checkbox]').forEach((box) => {
      box.checked = cb.checked;
    });
    _updateLearningSelectionUI();
    _updateLearningSelectAll();
  }

  function _updateLearningSelectAll() {
    const cb = $('cb-learning-select-all');
    if (!learningRows.length) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    const checked = learningSelection.size;
    cb.checked = checked > 0 && checked === learningRows.length;
    cb.indeterminate = checked > 0 && checked < learningRows.length;
  }

  function _updateLearningSelectionUI() {
    const selected = _selectedLearningRows();
    const deleteAllowed = selected.length > 0 && selected.every((row) => !row.is_builtin);
    $('btn-learning-remove-selected').textContent = `Remove Selected (${selected.length})`;
    $('btn-learning-remove-selected').disabled = selected.length === 0;
    $('btn-learning-delete-selected').textContent = `Delete Permanently (${selected.length})`;
    $('btn-learning-delete-selected').disabled = !deleteAllowed;
  }

  async function removeSelectedLearningWords() {
    const cardIds = _selectedLearningRows().map((row) => row.card_id);
    if (!cardIds.length) return;
    if (!confirm(`Remove ${cardIds.length} word${cardIds.length !== 1 ? 's' : ''} from active learning?`)) return;
    try {
      const result = await Api.removeCardsFromLearning(cardIds);
      Toast.show(`Removed ${result.removed} word${result.removed !== 1 ? 's' : ''} from learning`, 'info');
      dropCards(cardIds);
      await loadLearningWords();
      await syncDueQueue({ replace: true, resetStats: false });
    } catch (e) {
      Toast.show(e.error || 'Failed to remove words', 'error');
    }
  }

  async function deleteSelectedLearningWords() {
    const rows = _selectedLearningRows();
    const cardIds = rows.map((row) => row.card_id);
    if (!cardIds.length) return;
    if (!rows.every((row) => !row.is_builtin)) return;
    if (!confirm(`Permanently delete ${cardIds.length} custom word${cardIds.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      const result = await Api.permanentDeleteCards(cardIds);
      Toast.show(`Deleted ${result.deleted} word${result.deleted !== 1 ? 's' : ''}`, 'info');
      dropCards(cardIds);
      await loadLearningWords();
      await syncDueQueue({ replace: true, resetStats: false });
    } catch (e) {
      Toast.show(e.error || 'Failed to delete words', 'error');
    }
  }

  function bindEvents() {
    cardScene.addEventListener('click', () => {
      if (state === S.FRONT) flip();
    });

    reviewBtns.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-button]');
      if (btn) submitReview(btn.dataset.button);
    });

    document.addEventListener('keydown', (e) => {
      if (state === S.EDITING) {
        if (e.key === 'Escape') cancelEdit();
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (state === S.FRONT) {
        if ([' ', 'Enter', 'ArrowLeft', 'ArrowRight', '1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          flip();
        }
      } else if (state === S.BACK) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          unflip();
        } else if (e.key === 'ArrowLeft' || e.key === '1') submitReview('again');
        else if (e.key === '2') submitReview('hard');
        else if (e.key === 'ArrowRight' || e.key === '3') submitReview('good');
        else if (e.key === '4') submitReview('easy');
        else if (e.key === 'e' || e.key === 'E') startEdit();
      }
    });

    $('btn-edit-save').addEventListener('click', saveEdit);
    $('btn-edit-cancel').addEventListener('click', cancelEdit);
    $('btn-edit-card').addEventListener('click', startEdit);
    $('btn-play-audio-front').addEventListener('click', (e) => {
      e.stopPropagation();
      _playCardAudio();
    });
    $('btn-play-audio-back').addEventListener('click', (e) => {
      e.stopPropagation();
      _playCardAudio();
    });

    cardScene.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    cardScene.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
        if (state === S.BACK) submitReview(dx < 0 ? 'again' : 'good');
        else if (state === S.FRONT) flip();
      } else if (Math.abs(dy) < 30 && Math.abs(dx) < 20) {
        if (state === S.FRONT) flip();
      }
    }, { passive: true });

    $('btn-open-learning-words').addEventListener('click', openLearningWordsPanel);
    $('btn-close-learning-words').addEventListener('click', closeLearningWordsPanel);
    $('cb-learning-select-all').addEventListener('change', _toggleLearningSelectAll);
    $('btn-learning-remove-selected').addEventListener('click', removeSelectedLearningWords);
    $('btn-learning-delete-selected').addEventListener('click', deleteSelectedLearningWords);
    $('learning-word-search').addEventListener('input', () => {
      clearTimeout(learningSearchTimer);
      learningSearchTimer = setTimeout(loadLearningWords, 250);
    });
    ['learning-deck-filter', 'learning-phase-filter', 'learning-cefr-mode', 'learning-cefr-level']
      .forEach((id) => $(id).addEventListener('change', loadLearningWords));
  }

  return {
    startSession,
    syncDueQueue,
    dropCards,
    showCard,
    flip,
    unflip,
    submitReview,
    startEdit,
    saveEdit,
    cancelEdit,
    bindEvents,
    openLearningWordsPanel,
    closeLearningWordsPanel,
  };
})();
