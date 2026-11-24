/* Deck browser, full-word panel, archive/reactivate flow */
const Decks = (() => {
  const $ = (id) => document.getElementById(id);

  let _currentDeckId = null;
  let _currentDeckBuiltin = false;
  let _allWords = [];
  let _selectedRows = new Map();
  let _searchTimer = null;

  function _escapeHtml(value) {
    const safeValue = value === undefined || value === null ? '' : value;
    return String(safeValue).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function _selectionKey(word) {
    if (word.card_id) return `card:${word.card_id}`;
    return `word:${String(word.word || '').toLowerCase()}`;
  }

  function _clearSelection() {
    _selectedRows.clear();
    _updateSelectionUI();
    _updateSelectAll();
  }

  function _stageMeta(word) {
    if (!word.is_learning) {
      return {
        label: _currentDeckBuiltin ? 'Not Added' : 'Not In Learning',
        className: 'status-inactive',
      };
    }
    if (word.stage === 'learned' || word.phase === 'review') {
      return { label: 'Learned', className: 'status-learned' };
    }
    if (word.stage === 'practiced' || word.phase === 'learning') {
      return { label: 'Practiced', className: 'status-practiced' };
    }
    return { label: 'To Learn', className: 'status-added' };
  }

  function _statusMeta(word) {
    return _stageMeta(word);
  }

  function _selectedItems() {
    return [..._selectedRows.values()];
  }

  async function loadDecks() {
    try {
      const { decks } = await Api.getDecks();
      _renderDeckGrid(decks);
    } catch (e) {
      console.error(e);
    }
  }

  function _renderDeckGrid(decks) {
    const grid = $('deck-grid');
    grid.innerHTML = '';
    decks.forEach(deck => {
      const card = document.createElement('div');
      card.className = 'deck-card';
      card.dataset.deckId = deck.id;
      const pct = deck.progress_pct || 0;
      const revised = deck.revised_count || deck.learned_count || 0;
      card.innerHTML = `
        <div class="deck-card-header">
          <div class="deck-card-title">${_escapeHtml(deck.name)}</div>
          <div class="deck-card-actions">
            ${deck.is_builtin ? '<span class="deck-builtin-badge">Built-in</span>' : `
              <button class="btn-icon btn-delete-deck" data-deck-id="${deck.id}" title="Delete deck">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>`}
          </div>
        </div>
        ${deck.description ? `<div class="deck-desc">${_escapeHtml(deck.description)}</div>` : ''}
        <div class="deck-stats">
          <div class="deck-stat">
            <div class="deck-stat-val">${deck.total_words || 0}</div>
            <div class="deck-stat-lbl">Total</div>
          </div>
          <div class="deck-stat">
            <div class="deck-stat-val">${revised}</div>
            <div class="deck-stat-lbl">Revised</div>
          </div>
          <div class="deck-stat">
            <div class="deck-stat-val" style="color:var(--accent)">${deck.due_count || 0}</div>
            <div class="deck-stat-lbl">Due</div>
          </div>
        </div>
        <div class="deck-progress-row">
          <div class="deck-bar"><div class="deck-bar-fill" style="width:${pct}%"></div></div>
          <span class="deck-pct">${pct}%</span>
        </div>`;

      const delBtn = card.querySelector('.btn-delete-deck');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteDeck(deck.id, deck.name);
        });
      }

      card.addEventListener('click', () => openDeck(deck));
      grid.appendChild(card);
    });
  }

  async function deleteDeck(deckId, deckName) {
    if (!confirm(`Delete deck "${deckName}" and all its words? This cannot be undone.`)) return;
    try {
      await Api.deleteDeck(deckId);
      Toast.show(`Deck "${deckName}" deleted`, 'info');
      loadDecks();
    } catch (e) {
      Toast.show(e.error || 'Failed to delete deck', 'error');
    }
  }

  async function openDeck(deck) {
    _currentDeckId = deck.id;
    _currentDeckBuiltin = !!deck.is_builtin;
    _clearSelection();

    $('word-panel-title').textContent = deck.name;
    $('word-search').value = '';
    $('word-filter').value = 'all';
    $('word-cefr-mode').value = 'all';
    $('word-cefr-level').value = 'B2';
    $('word-panel').hidden = false;
    $('word-list').innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Loading…</div>';

    $('btn-add-all-deck').style.display = _currentDeckBuiltin ? '' : 'none';
    $('btn-delete-selected').style.display = _currentDeckBuiltin ? 'none' : '';
    $('word-filter').querySelector('option[value="inactive"]').textContent = _currentDeckBuiltin ? 'Not Added' : 'Not In Learning';

    const total = deck.total_words || 0;
    const revised = deck.revised_count || deck.learned_count || 0;
    const pct = total > 0 ? Math.round(revised / total * 100) : 0;
    $('wp-progress-fill').style.width = pct + '%';
    $('wp-progress-text').textContent = `${revised} / ${total} revised (${pct}%)`;

    await loadWords();
  }

  async function loadWords() {
    if (!_currentDeckId) return;
    const search = $('word-search').value.trim();
    const filter = $('word-filter').value;
    const cefrMode = $('word-cefr-mode').value;
    const cefrLevel = $('word-cefr-level').value;
    try {
      const params = { all: 1, filter, cefr_mode: cefrMode, cefr_level: cefrLevel };
      if (search) params.search = search;
      const data = await Api.getDeckWords(_currentDeckId, params);
      _allWords = data.words || [];
      _selectedRows.clear();
      _renderWordList(_allWords);
    } catch (e) {
      console.error(e);
      $('word-list').innerHTML = '<div style="padding:20px;color:var(--red)">Failed to load words.</div>';
      _clearSelection();
    }
  }

  function _renderWordList(words) {
    const list = $('word-list');
    if (!words.length) {
      list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No words found.</div>';
      _clearSelection();
      return;
    }

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    words.forEach(word => {
      const row = document.createElement('div');
      row.className = 'word-item';
      const key = _selectionKey(word);
      const isSelected = _selectedRows.has(key);
      const status = _statusMeta(word);
      const cefr = word.cefr_level || 'Unknown';
      const hint = word.hint || word.notes || '';
      row.innerHTML = `
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <div class="word-item-main">
          <div class="word-item-top">
            <span class="word-item-word">${_escapeHtml(word.word)}</span>
            <span class="word-item-pos">${_escapeHtml(word.pos || '')}</span>
            ${word.cefr_level ? `<span class="word-item-cefr">${_escapeHtml(cefr)}</span>` : ''}
          </div>
          <div class="word-item-hint">${_escapeHtml(hint)}</div>
        </div>
        <span class="word-item-status ${status.className}">${status.label}</span>`;

      row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
        if (e.target.checked) _selectedRows.set(key, word);
        else _selectedRows.delete(key);
        _updateSelectionUI();
        _updateSelectAll();
      });
      fragment.appendChild(row);
    });

    list.appendChild(fragment);
    _updateSelectionUI();
    _updateSelectAll();
  }

  function _toggleSelectAll() {
    const cb = $('cb-select-all');
    if (cb.checked) {
      _allWords.forEach(word => _selectedRows.set(_selectionKey(word), word));
    } else {
      _selectedRows.clear();
    }
    const boxes = $('word-list').querySelectorAll('input[type=checkbox]');
    boxes.forEach(box => { box.checked = cb.checked; });
    _updateSelectionUI();
    _updateSelectAll();
  }

  function _updateSelectAll() {
    const cb = $('cb-select-all');
    if (!cb) return;
    if (!_allWords.length) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    const checked = _selectedRows.size;
    cb.checked = checked > 0 && checked === _allWords.length;
    cb.indeterminate = checked > 0 && checked < _allWords.length;
  }

  function _updateSelectionUI() {
    const selected = _selectedItems();
    const addable = selected.filter(word => !word.is_learning);
    const removable = selected.filter(word => word.is_learning && word.card_id);
    const deletable = !_currentDeckBuiltin
      ? selected.filter(word => word.card_id)
      : [];

    $('btn-add-selected').textContent = `Add Selected (${addable.length})`;
    $('btn-add-selected').disabled = addable.length === 0;

    $('btn-remove-selected').textContent = `Remove Selected (${removable.length})`;
    $('btn-remove-selected').disabled = removable.length === 0;

    const deleteBtn = $('btn-delete-selected');
    deleteBtn.textContent = `Delete Permanently (${deletable.length})`;
    deleteBtn.disabled = deletable.length === 0;
  }

  async function addSelected() {
    const words = _selectedItems().filter(word => !word.is_learning).map(word => word.word);
    if (!words.length) return;
    $('btn-add-selected').disabled = true;
    $('btn-add-selected').textContent = 'Adding…';
    try {
      const result = await Api.addWordsToDeck(_currentDeckId, words);
      await Learning.syncDueQueue();
      Toast.show(`Added ${result.added} word${result.added !== 1 ? 's' : ''} to learning`, 'success');
      await loadWords();
    } catch (e) {
      Toast.show(e.error || 'Failed to add words', 'error');
    } finally {
      _updateSelectionUI();
    }
  }

  async function addAll() {
    $('btn-add-all-deck').disabled = true;
    $('btn-add-all-deck').textContent = 'Adding…';
    try {
      const result = await Api.addAllToDeck(_currentDeckId, {
        search: $('word-search').value.trim(),
        filter: $('word-filter').value,
        cefr_mode: $('word-cefr-mode').value,
        cefr_level: $('word-cefr-level').value,
      });
      await Learning.syncDueQueue();
      Toast.show(`Added ${result.added} word${result.added !== 1 ? 's' : ''} to learning`, 'success');
      await loadWords();
    } catch (e) {
      Toast.show(e.error || 'Failed to add words', 'error');
    } finally {
      $('btn-add-all-deck').disabled = false;
      $('btn-add-all-deck').textContent = 'Add All Words';
    }
  }

  async function removeSelected() {
    const cardIds = _selectedItems()
      .filter(word => word.is_learning && word.card_id)
      .map(word => word.card_id);
    if (!cardIds.length) return;
    const message = _currentDeckBuiltin
      ? `Return ${cardIds.length} word${cardIds.length !== 1 ? 's' : ''} from learning back to this deck?`
      : `Remove ${cardIds.length} word${cardIds.length !== 1 ? 's' : ''} from active learning and keep them in this deck?`;
    if (!confirm(message)) return;

    $('btn-remove-selected').disabled = true;
    $('btn-remove-selected').textContent = 'Removing…';
    try {
      const result = await Api.removeWordsFromDeck(_currentDeckId, cardIds);
      Learning.dropCards(cardIds);
      Toast.show(`Removed ${result.removed} word${result.removed !== 1 ? 's' : ''} from learning`, 'info');
      await loadWords();
    } catch (e) {
      Toast.show(e.error || 'Failed to remove words', 'error');
    } finally {
      _updateSelectionUI();
    }
  }

  async function deleteSelectedPermanently() {
    const cardIds = _selectedItems()
      .filter(word => word.card_id)
      .map(word => word.card_id);
    if (!cardIds.length || _currentDeckBuiltin) return;
    if (!confirm(`Permanently delete ${cardIds.length} word${cardIds.length !== 1 ? 's' : ''} from this deck? This cannot be undone.`)) return;

    $('btn-delete-selected').disabled = true;
    $('btn-delete-selected').textContent = 'Deleting…';
    try {
      const result = await Api.permanentDeleteCards(cardIds);
      Learning.dropCards(cardIds);
      Toast.show(`Deleted ${result.deleted} word${result.deleted !== 1 ? 's' : ''}`, 'info');
      await loadWords();
    } catch (e) {
      Toast.show(e.error || 'Failed to delete words', 'error');
    } finally {
      _updateSelectionUI();
    }
  }

  function closeDeck() {
    $('word-panel').hidden = true;
    _currentDeckId = null;
    _currentDeckBuiltin = false;
    _allWords = [];
    _clearSelection();
    loadDecks();
  }

  async function createDeck() {
    const name = $('new-deck-name').value.trim();
    if (!name) {
      $('new-deck-name').focus();
      return;
    }
    try {
      await Api.createDeck({ name, description: $('new-deck-desc').value.trim() });
      Modal.close('modal-new-deck');
      $('new-deck-name').value = '';
      $('new-deck-desc').value = '';
      Toast.show(`Deck "${name}" created`, 'success');
      loadDecks();
    } catch (e) {
      Toast.show(e.error || 'Failed to create deck', 'error');
    }
  }

  function bindEvents() {
    $('btn-close-deck').addEventListener('click', closeDeck);
    $('btn-add-selected').addEventListener('click', addSelected);
    $('btn-add-all-deck').addEventListener('click', addAll);
    $('btn-remove-selected').addEventListener('click', removeSelected);
    $('btn-delete-selected').addEventListener('click', deleteSelectedPermanently);
    $('btn-new-deck').addEventListener('click', () => Modal.open('modal-new-deck'));
    $('btn-create-deck').addEventListener('click', createDeck);
    $('cb-select-all').addEventListener('change', _toggleSelectAll);

    $('word-search').addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(loadWords, 250);
    });
    $('word-filter').addEventListener('change', loadWords);
    $('word-cefr-mode').addEventListener('change', loadWords);
    $('word-cefr-level').addEventListener('change', loadWords);
    $('new-deck-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createDeck();
    });
  }

  return { loadDecks, openDeck, bindEvents };
})();
