/* ══════════════════════════════════════════
   main.js  —  App init, router, theme, streak, daily goal, add-word flow
   ══════════════════════════════════════════ */

/* ────────────────────────────
   Toast helper
   ──────────────────────────── */
const Toast = (() => {
  const container = document.getElementById('toast-container');
  function show(msg, type = 'info', duration = 2800) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
  }
  return { show };
})();

/* ────────────────────────────
   Modal helper
   ──────────────────────────── */
const Modal = (() => {
  function open(id) {
    const el = document.getElementById(id);
    if (el) { el.hidden = false; el.style.display = ''; }
  }
  function close(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  function bindClosers() {
    document.querySelectorAll('.modal-close[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => close(btn.dataset.modal));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(overlay.id);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay:not([hidden])').forEach(o => close(o.id));
      }
    });
  }
  return { open, close, bindClosers };
})();

/* ────────────────────────────
   Main App
   ──────────────────────────── */
const App = (() => {
  const $ = (id) => document.getElementById(id);

  let _settings = { daily_goal: 20, theme: 'dark' };
  let _addWordData = {
    word: '', phonetic: '', phonetics: [], meanings: [],
    selectedMeaning: null, source: 'freedict', register: '', audio_url: '',
  };

  function _escapeHtml(value) {
    const safeValue = value === undefined || value === null ? '' : value;
    return String(safeValue).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // ─── Navigation ───
  function navigate(view) {
    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active');
      v.hidden = true;
    });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const section = document.getElementById(`view-${view}`);
    if (section) { section.hidden = false; section.classList.add('active'); }

    const navBtn = document.getElementById(`nav-${view}`);
    if (navBtn) navBtn.classList.add('active');

    if (view === 'decks')    Decks.loadDecks();
    if (view === 'stats')    _loadStats();
    if (view === 'learning') {
      if (SRS.size() === 0) Learning.startSession();
      else Learning.syncDueQueue();
    }
  }

  // ─── Theme ───
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = $('btn-theme-toggle');
    const nextMode = theme === 'dark' ? 'light' : 'dark';
    toggle.title = `Switch to ${nextMode} mode`;
    toggle.setAttribute('aria-label', `Switch to ${nextMode} mode`);
    _settings.theme = theme;
    document.querySelectorAll('.theme-choice').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
  }

  function toggleTheme() {
    setTheme(_settings.theme === 'dark' ? 'light' : 'dark');
  }

  // ─── Daily goal / streak UI ───
  function _updateHeader(stats) {
    if (!stats) return;
    $('streak-count').textContent = stats.streak || 0;
    const badge = $('streak-badge');
    if (stats.streak >= 7 && stats.streak % 7 === 0) {
      badge.classList.add('milestone');
      setTimeout(() => badge.classList.remove('milestone'), 700);
    }

    const reviewed = stats.reviewed_today || 0;
    const goal     = stats.daily_goal     || _settings.daily_goal || 20;
    $('reviewed-today').textContent   = reviewed;
    $('daily-goal-display').textContent = goal;
    const pct = Math.min(100, Math.round(reviewed / goal * 100));
    $('goal-fill').style.width = pct + '%';
  }

  function onCardReviewed() {
    const cur  = parseInt($('reviewed-today').textContent || '0') + 1;
    const goal = parseInt($('daily-goal-display').textContent || '20');
    $('reviewed-today').textContent = cur;
    const pct = Math.min(100, Math.round(cur / goal * 100));
    $('goal-fill').style.width = pct + '%';
  }

  // ─── Stats view ───
  async function _loadStats() {
    try {
      const stats = await Api.getStats();
      $('stats-streak').textContent  = stats.streak || 0;
      $('stats-learned').textContent = stats.total_revised || stats.total_learned || 0;
      $('stats-today').textContent   = stats.reviewed_today || 0;
      $('stats-due').textContent     = stats.due_now || 0;
      _renderForecast(stats.upcoming_7d || []);
      _renderDeckProgress();
    } catch (e) { console.error(e); }
  }

  function _renderForecast(upcoming) {
    const chart = $('forecast-chart');
    chart.innerHTML = '';
    const max = Math.max(...upcoming.map(u => u.count), 1);
    upcoming.forEach((u, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'forecast-bar-wrap';
      const h   = Math.max(3, Math.round((u.count / max) * 90));
      const lbl = i === 0 ? 'Today' : _shortDate(u.date);
      wrap.innerHTML = `
        <span class="forecast-count">${u.count}</span>
        <div class="forecast-bar" style="height:${h}px"></div>
        <span class="forecast-lbl">${lbl}</span>`;
      chart.appendChild(wrap);
    });
  }

  function _shortDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en', { weekday: 'short' });
  }

  async function _renderDeckProgress() {
    try {
      const { decks } = await Api.getDecks();
      const list = $('deck-progress-list');
      list.innerHTML = '';
      decks.forEach(deck => {
        const total   = deck.total_words || 0;
        const revised = deck.revised_count || deck.learned_count || 0;
        const pct     = total > 0 ? Math.round(revised / total * 100) : 0;
      const item    = document.createElement('div');
      item.className = 'dp-item';
      item.innerHTML = `
          <div class="dp-header">
            <span class="dp-name">${_escapeHtml(deck.name)}</span>
            <span class="dp-counts">${revised} / ${total}</span>
          </div>
          <div class="dp-bar"><div class="dp-bar-fill" style="width:${pct}%"></div></div>`;
      list.appendChild(item);
      });
    } catch(e) { /* silent */ }
  }

  // ─────────────────────────────────────
  //  ADD WORD FLOW
  // ─────────────────────────────────────
  function _openAddWord() {
    _addWordData = {
      word: '', phonetic: '', phonetics: [], meanings: [],
      selectedMeaning: null, source: 'freedict', register: '', audio_url: '',
    };
    _showStep('step-input');
    $('word-input').value     = '';
    $('lookup-error').hidden  = true;
    $('lookup-spinner').hidden = true;
    $('lookup-word-display').textContent = '';
    $('lookup-phonetic-display').textContent = '';
    $('selected-meaning-preview').textContent = '';
    $('relookup-input').value = '';
    $('register-select').value = '';
    $('collocations-input').value = '';
    $('notes-input').value = '';
    $('deck-select').innerHTML = '';
    // Reset source tabs
    document.querySelectorAll('.source-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.source === 'freedict');
    });
    Modal.open('modal-add-word');
    setTimeout(() => $('word-input').focus(), 100);
  }

  function _showStep(stepId) {
    ['step-input', 'step-meanings', 'step-customize'].forEach(id => {
      $(id).hidden = (id !== stepId);
    });
  }

  // ─── Dictionary source toggle ───
  function _setSource(source) {
    _addWordData.source = source;
    document.querySelectorAll('.source-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.source === source);
    });
  }

  // ─── Lookup word (uses current source) ───
  async function _lookupWord(overrideWord) {
    const word = (overrideWord || $('word-input').value.trim());
    if (!word) { $('word-input').focus(); return; }

    // Sync word-input if override supplied (re-lookup from step-meanings)
    if (overrideWord) $('word-input').value = overrideWord;

    $('lookup-error').hidden   = true;
    $('lookup-spinner').hidden = false;
    $('btn-lookup').disabled   = true;

    try {
      let data;
      if (_addWordData.source === 'wiktionary') data = await Api.lookupWiktionary(word);
      else if (_addWordData.source === 'cambridge') data = await Api.lookupCambridge(word);
      else if (_addWordData.source === 'oxford') data = await Api.lookupOxford(word);
      else data = await Api.lookupWord(word);

      if (data.error) throw data;

      _addWordData.word      = data.word;
      _addWordData.phonetic  = data.phonetic  || '';
      _addWordData.phonetics = data.phonetics || [];
      _addWordData.meanings  = data.meanings  || [];
      _addWordData.register  = data.register  || '';
      _addWordData.audio_url = data.audio_url || '';
      _showMeanings(data);
    } catch (e) {
      $('lookup-spinner').hidden = true;
      $('btn-lookup').disabled   = false;
      $('lookup-error').hidden   = false;
      $('lookup-error-msg').textContent =
        e.error === 'not_found'       ? `"${word}" not found in dictionary.` :
        e.error === 'api_unavailable' ? 'Dictionary unavailable. Check your internet.' :
        'Something went wrong. Try again.';
    } finally {
      $('lookup-spinner').hidden = true;
      $('btn-lookup').disabled   = false;
    }
  }

  function _showMeanings(data) {
    $('lookup-word-display').textContent = data.word;

    // Display ALL unique IPA variants (e.g.  /wɜːrd/  ·  /wɝːd/)
    const phoneticsArr = data.phonetics || [];
    const phoneticStr  = phoneticsArr.map(p => p.text).filter(Boolean).join('  ·  ')
                         || data.phonetic || '';
    $('lookup-phonetic-display').textContent = phoneticStr;

    // Pre-fill re-lookup input with current word
    const reInput = $('relookup-input');
    if (reInput) reInput.value = data.word;

    const list = $('meanings-list');
    list.innerHTML = '';

    data.meanings.forEach((m, mi) => {
      (m.definitions || []).forEach((def, di) => {
        const btn = document.createElement('button');
        btn.className = 'meaning-option';
        btn.dataset.mi = mi;
        btn.dataset.di = di;
        btn.innerHTML = `
          <div class="meaning-pos">${_escapeHtml(m.partOfSpeech || '')}</div>
          <div class="meaning-def">${_escapeHtml(def.definition || '')}</div>
          ${def.example ? `<div class="meaning-ex">"${_escapeHtml(def.example)}"</div>` : ''}`;
        btn.addEventListener('click', () => _selectMeaning(m, def, btn));
        list.appendChild(btn);
      });
    });

    if (!data.meanings.length) {
      list.innerHTML = '<div style="padding:16px;color:var(--text-muted)">No definitions found.</div>';
    }

    _showStep('step-meanings');
  }

  async function _selectMeaning(meaning, definition, clickedBtn) {
    document.querySelectorAll('.meaning-option').forEach(b => b.classList.remove('selected'));
    clickedBtn.classList.add('selected');

    _addWordData.selectedMeaning = { meaning, definition };

    $('selected-meaning-preview').innerHTML = `
      <div class="preview-pos">${_escapeHtml(meaning.partOfSpeech || '')}</div>
      <div class="preview-def">${_escapeHtml(definition.definition || '')}</div>
      ${definition.example
        ? `<div style="font-size:var(--fs-xs);color:var(--text-secondary);font-style:italic;margin-top:4px;">"${_escapeHtml(definition.example)}"</div>`
        : ''}`;

    // Pre-fill collocations from synonyms
    const syns = (definition.synonyms || []).slice(0, 6);
    $('collocations-input').value = syns.join(', ');

    // Auto-fill register from API inference
    if (_addWordData.register) {
      $('register-select').value = _addWordData.register;
    }

    await _loadDeckOptions();
    _showStep('step-customize');
  }

  async function _loadDeckOptions() {
    try {
      const { decks } = await Api.getDecks();
      const sel = $('deck-select');
      sel.innerHTML = '';
      const userDecks = decks.filter(d => !d.is_builtin);
      if (!userDecks.length) {
        sel.innerHTML = '<option value="">My Words (auto-created)</option>';
      } else {
        userDecks.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name;
          sel.appendChild(opt);
        });
      }
    } catch (e) { /* silent */ }
  }

  async function _saveCard() {
    const { word, phonetic, selectedMeaning } = _addWordData;
    if (!selectedMeaning) return;

    const deckId = $('deck-select').value || undefined;
    const reg    = $('register-select').value;
    const colls  = $('collocations-input').value.split(',').map(s => s.trim()).filter(Boolean);
    const notes  = $('notes-input').value.trim();

    const defData = {
      meanings: [{
        partOfSpeech: selectedMeaning.meaning.partOfSpeech,
        definitions:  [{
          definition: selectedMeaning.definition.definition,
          example:    selectedMeaning.definition.example || '',
          synonyms:   selectedMeaning.definition.synonyms || [],
        }],
      }],
    };

    $('btn-save-card').disabled    = true;
    $('btn-save-card').textContent = 'Adding…';
    try {
      await Api.createCard({
        word, phonetic, deck_id: deckId ? parseInt(deckId) : undefined,
        definition_data: defData,
        collocations: colls,
        register: reg,
        notes,
        audio_url: _addWordData.audio_url || '',
      });
      await Learning.syncDueQueue();
      Modal.close('modal-add-word');
      Toast.show(`"${word}" added!`, 'success');
      $('notes-input').value = '';
    } catch (e) {
      if (e.error === 'already_exists') Toast.show(`"${word}" is already in this deck`, 'info');
      else Toast.show('Failed to save card', 'error');
    } finally {
      $('btn-save-card').disabled    = false;
      $('btn-save-card').textContent = 'Add Card';
    }
  }

  // ─────────────────────────────────────
  //  Settings
  // ─────────────────────────────────────
  async function _openSettings() {
    $('daily-goal-input').value = _settings.daily_goal || 20;
    setTheme(_settings.theme);
    Modal.open('modal-settings');
  }

  async function _saveSettings() {
    const goal  = parseInt($('daily-goal-input').value) || 20;
    const theme = document.querySelector('.theme-choice.active')?.dataset.theme || 'dark';
    _settings.daily_goal = goal;
    _settings.theme      = theme;
    try {
      await Api.saveSettings({ daily_goal: goal, theme });
      setTheme(theme);
      $('daily-goal-display').textContent = goal;
      Modal.close('modal-settings');
      Toast.show('Settings saved', 'success');
    } catch (e) {
      Toast.show('Failed to save settings', 'error');
    }
  }

  // ─────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────
  async function init() {
    try {
      _settings = await Api.getSettings();
      setTheme(_settings.theme || 'dark');
    } catch (e) {
      setTheme('dark');
    }

    try {
      const stats = await Api.getStats();
      _settings.daily_goal = stats.daily_goal || _settings.daily_goal;
      _updateHeader(stats);
    } catch (e) { /* silent */ }

    Learning.bindEvents();
    Decks.bindEvents();
    Modal.bindClosers();

    // Navigation
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.view));
    });

    // Theme toggle
    $('btn-theme-toggle').addEventListener('click', () => {
      toggleTheme();
      Api.saveSettings({ theme: _settings.theme }).catch(() => {});
    });

    // Settings modal
    $('btn-settings').addEventListener('click', _openSettings);
    $('btn-save-settings').addEventListener('click', _saveSettings);
    $('goal-minus').addEventListener('click', () => {
      const v = Math.max(1, parseInt($('daily-goal-input').value || 20) - 5);
      $('daily-goal-input').value = v;
    });
    $('goal-plus').addEventListener('click', () => {
      const v = Math.min(500, parseInt($('daily-goal-input').value || 20) + 5);
      $('daily-goal-input').value = v;
    });
    document.querySelectorAll('.theme-choice').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.theme-choice').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        setTheme(b.dataset.theme);
      });
    });

    // Source tabs (both in step-input and step-meanings share the same class)
    document.querySelectorAll('.source-tab').forEach(t => {
      t.addEventListener('click', () => {
        _setSource(t.dataset.source);
        // Re-lookup: use cached word if in step-meanings, otherwise word-input
        const word = _addWordData.word || $('word-input').value.trim();
        if (word) {
          // Show loading state in meanings list if step-meanings is visible
          if (!$('step-meanings').hidden) {
            $('meanings-list').innerHTML =
              '<div style="padding:20px;text-align:center;color:var(--text-muted)">Loading…</div>';
          }
          _lookupWord(word);
        }
      });
    });

    // Add word flow
    $('btn-add-word').addEventListener('click', _openAddWord);
    $('btn-lookup').addEventListener('click', () => _lookupWord());
    $('word-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') _lookupWord();
    });
    $('btn-back-input').addEventListener('click', () => _showStep('step-input'));
    $('btn-back-meanings').addEventListener('click', () => _showStep('step-meanings'));

    // Re-lookup from step-meanings (change word without going back)
    const relookupInput = $('relookup-input');
    const relookupBtn   = $('btn-relookup');
    if (relookupInput && relookupBtn) {
      relookupBtn.addEventListener('click', () => {
        const w = relookupInput.value.trim();
        if (w) _lookupWord(w);
      });
      relookupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const w = relookupInput.value.trim();
          if (w) _lookupWord(w);
        }
      });
    }

    $('btn-add-manual').addEventListener('click', () => {
      _addWordData.word = $('word-input').value.trim();
      _addWordData.selectedMeaning = {
        meaning:    { partOfSpeech: '' },
        definition: { definition: '', example: '' },
      };
      $('selected-meaning-preview').innerHTML =
        '<span style="color:var(--text-muted)">No definition — card will be saved without one.</span>';
      $('collocations-input').value = '';
      _loadDeckOptions().then(() => _showStep('step-customize'));
    });
    $('btn-save-card').addEventListener('click', _saveCard);

    navigate('learning');
  }

  return { init, navigate, onCardReviewed, setTheme };
})();

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', () => App.init());
