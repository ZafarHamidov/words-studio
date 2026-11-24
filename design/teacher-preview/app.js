/* Interactive classroom design prototype. Sample activity is local to this preview. */
(() => {
  'use strict';
  const STORAGE_KEY = 'words-studio-classroom-design-v1';
  const $ = id => document.getElementById(id);
  const teacherNavigation = $('navigation').innerHTML;
  const teacherProfile = $('profile-button').innerHTML;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icons = {
    book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v14M6 9h3m6 0h3M6 12h3m6 0h3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
    layers: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12M7 11h6m-6 4h4"/>',
    chart: '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8v-8"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    settings: '<path d="m9 3 1-1h4l1 3 3 1 3 2v4l-2 1-1 3 1 3-3 2-3-1-3 1-3-2 1-3-2-2H2V9l3-1 2-3Z"/><circle cx="12" cy="11" r="3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2m0 3h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    download: '<path d="M12 3v11m-4-4 4 4 4-4M4 16v4h16v-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    checkcircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flame: '<path d="M13 3c1 6 6 6 6 12a7 7 0 0 1-14 0c0-4 3-6 4-8 0 3 2 4 2 4s3-4 2-8Z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 4H5a1 1 0 0 0-1 1v10"/>',
    flag: '<path d="M5 21V3c5-3 9 3 14 0v11c-5 3-9-3-14 0"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    medal: '<circle cx="12" cy="15" r="6"/><path d="m7 11-4-8h6l3 6m5 2 4-8h-6l-3 6"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
  const hydrateIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const palette = [['#f0e6e3','#a47b70'],['#e5edec','#648b81'],['#ece9f5','#8b7cb0'],['#e8edf7','#7089af'],['#f5ecd9','#ac925b'],['#e8eee2','#81936a']];
  const sampleStudents = [
    ['Maya Chen',318,42,96,12,'Today, 09:12',0],['Oliver Bennett',301,38,94,8,'Today, 08:45',0],
    ['Sofia Martinez',289,35,92,10,'Today, 08:20',0],['Noah Williams',286,45,91,7,'Today, 07:56',0],
    ['Amelia Davis',279,39,93,11,'Yesterday',1],['Leo Anderson',271,33,89,6,'Today, 09:05',0],
    ['Isla Thompson',265,31,90,5,'Yesterday',1],['Ethan Wilson',258,36,88,7,'Today, 08:32',0],
    ['Ava Robinson',252,29,87,4,'Yesterday',1],['Lucas Taylor',241,35,86,5,'Today, 07:40',0],
    ['Freya Clark',233,21,85,3,'2 days ago',2],['Henry Lewis',226,18,84,2,'Yesterday',1],
    ['Zara Walker',218,25,83,4,'2 days ago',2],['Oscar Hall',205,10,72,1,'3 days ago',3],
    ['Ella Young',188,0,77,0,'8 days ago',8],['Theo Allen',166,0,68,0,'9 days ago',9],
    ['Grace King',142,14,71,2,'Yesterday',1],['Arjun Patel',104,8,69,1,'3 days ago',3],
  ].map((row, i) => ({ id: i + 1, name: row[0], learned: row[1], weekly: row[2], accuracy: row[3], streak: row[4], last: row[5], daysAgo: row[6], learning: 24 + (i * 7 % 31), reviewedWords: [] }));
  const defaultState = () => ({ className: 'English B2', goal: 35, students: structuredClone(sampleStudents), assignments: [
    { id: 1, title: 'Build your academic vocabulary', start: 201, count: 35, due: '2026-11-27', type: 'Active', complete: 10 },
    { id: 2, title: 'A stronger foundation', start: 166, count: 35, due: '2026-11-20', type: 'Completed', complete: 18 },
  ] });
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState(); } catch { state = defaultState(); }
  if (!Array.isArray(state.students) || state.students.length !== 18) state = defaultState();
  let deck = [], selectedStudent = 1, role = 'teacher', currentView = 'overview', rosterFilter = 'all', rosterSearch = '', rosterPage = 1, sortDescending = true, period = 'week', deckSearch = '', wordLimit = 18, practice = null;
  const initials = name => name.split(' ').map(word => word[0]).slice(0, 2).join('');
  const avatar = (student, size = '') => { const color = palette[(student.id - 1) % palette.length]; return `<span class="avatar ${size}" style="background:${color[0]};color:${color[1]}">${initials(student.name)}</span>`; };
  const percentage = student => Math.round(student.learned / 570 * 100);
  const needsHelp = student => student.accuracy < 75 || student.daysAgo >= 4;
  const status = student => student.daysAgo >= 7 ? `<span class="status inactive">${icon('clock')}Inactive</span>` : needsHelp(student) ? `<span class="status attention">${icon('flag')}Needs practice</span>` : `<span class="status">${icon('check')}On track</span>`;
  const currentStudent = () => state.students.find(student => student.id === selectedStudent) || state.students[0];
  const currentAssignment = () => state.assignments.find(item => item.type === 'Active') || state.assignments[0];
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { toast('Your browser could not save this preview session.'); } };
  const formatDate = value => new Date(value + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200); }
  function closeDialog() { $('dialog').close(); practice = null; }
  function dialog(title, body, footer = '') {
    const element = $('dialog');
    element.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>${body}${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
    if (!element.open) element.showModal();
  }
  function metric(label, number, sub, kind, spark = true) {
    return `<article class="metric"><div class="metric-label">${label}${icon(kind)}</div><div class="metric-number">${number}</div><div class="metric-foot">${sub}</div>${spark ? '<svg class="sparkline" viewBox="0 0 80 30"><path d="m1 26 8-4 8 2 8-10 8 4 8-4 8 5 8-13 8 3 8-7"/></svg>' : ''}</article>`;
  }
  function heading(title, description, actions = '') {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
  }
  function teacherActions() {
    return `<button class="button" data-action="export">${icon('download')}Export report</button><button class="button primary" data-action="invite">${icon('plus')}Invite students</button>`;
  }
  function metrics() {
    const average = Math.round(state.students.reduce((sum, s) => sum + s.learned, 0) / 18);
    const learned = state.students.reduce((sum, s) => sum + s.learned, 0);
    const active = state.students.filter(s => s.daysAgo < 7).length;
    const accuracy = Math.round(state.students.reduce((sum, s) => sum + s.accuracy, 0) / 18);
    return `<div class="metrics-grid">${metric('Average deck progress', `${Math.round(average / 570 * 100)}<small>%</small>`, `<span class="trend">+7.2%</span> vs. last week`, 'target')}${metric('Words learned', learned.toLocaleString('en'), `${average} words per student`, 'book')}${metric('Active this week', `${active}<small>/ 18</small>`, `${18 - active} students haven’t practiced`, 'users', false).replace('</article>', `<div class="mini-avatar-stack">${state.students.slice(0, 3).map(student => avatar(student)).join('')}</div></article>`)}${metric('Recall accuracy', `${accuracy}<small>%</small>`, '<span class="trend">+4%</span> vs. last week', 'checkcircle')}</div>`;
  }
  function learningChart() {
    const weekly = period === 'week';
    const labels = weekly ? ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'] : ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'This week'];
    const weeklyWords = state.students.reduce((sum, student) => sum + student.weekly, 0);
    const values = weekly ? [38,54,49,66,73,231,weeklyWords-231] : [247,359,426,501,weeklyWords];
    const points = values.map((value,i)=>[45+i*426/(values.length-1),133-value*(weekly?.35:.20)]);
    const line = points.map(([x,y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ');
    const totalWords = values.reduce((sum,value)=>sum+value,0).toLocaleString('en');
    return `<div class="panel chart-panel"><div class="panel-head"><div><h2>Learning activity</h2><p class="panel-subtitle">New words learned across the class</p></div><label class="select-wrap"><select id="period-select" aria-label="Activity period"><option value="week" ${weekly ? 'selected' : ''}>Last 7 days</option><option value="month" ${weekly ? '' : 'selected'}>Last 30 days</option></select>${icon('chevron')}</label></div><div class="chart-wrap"><div class="chart-legend"><span><i class="legend-line"></i>Words learned</span><span><i class="legend-line faint"></i>Previous period</span></div><svg class="activity-chart" role="img" aria-label="Class learning activity. ${totalWords} words learned in this period." viewBox="0 0 510 155" preserveAspectRatio="none"><defs><linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c76ef" stop-opacity=".15"/><stop offset="100%" stop-color="#7c76ef" stop-opacity=".01"/></linearGradient></defs>${[28,63,98].map((y,i)=>`<line x1="36" x2="490" y1="${y}" y2="${y}" stroke="#f0f0f6" stroke-dasharray="3 4"/><text x="2" y="${y+4}">${(weekly?[300,200,100]:[500,350,175])[i]}</text>`).join('')}<path d="M45 117 L116 108 L187 111 L258 94 L329 103 L400 78 L471 83" stroke="#d8d5fa" stroke-width="2" stroke-dasharray="4 5" fill="none"/><path d="${line} L471 133 L45 133Z" fill="url(#activity-fill)"/><path d="${line}" stroke="#6660e7" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="#6660e7" stroke-width="2" tabindex="0"><title>${labels[i]}: ${values[i]} words learned</title></circle><text x="${x}" y="151" text-anchor="middle">${labels[i]}</text>`).join('')}</svg></div><div class="chart-insight">${icon('checkcircle')}<span><strong>Looking good.</strong> Your class learned ${totalWords} words ${weekly ? 'in the last 7 days' : 'this month'}.</span></div></div>`;
  }
  function focusCard() {
    const assignment = currentAssignment(), percent = Math.round(assignment.complete / 18 * 100);
    return `<article class="panel focus-panel"><div class="panel-head"><h2>This week’s focus</h2><span class="badge blue">Active</span></div><div class="focus-content"><div class="assignment-label"><div class="book-cover">${icon('book')}</div><div><strong>Academic Word List</strong><p>Words ${assignment.start}–${assignment.start + assignment.count - 1} · ${assignment.count} words</p></div></div><div class="assignment-meta"><span>${assignment.complete} of 18 students completed</span><strong>${percent}%</strong></div><div class="progress-track"><span style="width:${percent}%"></span></div><div class="assignment-footer"><span>${icon('calendar')}Due ${formatDate(assignment.due)}</span><button class="text-link" data-assignment="${assignment.id}">View assignment</button></div></div></article>`;
  }
  function rosterPanel(full = false) {
    const attention = state.students.filter(needsHelp).length;
    return `<section class="panel student-panel" id="roster-panel"><div class="panel-head"><div class="panel-title-group"><h2>Student progress</h2><span class="count-pill">18 students</span></div>${full ? `<label class="select-wrap"><select id="roster-sort" aria-label="Sort students"><option value="desc">Most words learned</option><option value="asc">Fewest words learned</option></select>${icon('chevron')}</label>` : '<button class="text-link" data-go="students">View all students</button>'}</div><div class="table-toolbar"><div class="tab-group" aria-label="Student filters"><button class="filter-tab ${rosterFilter==='all'?'selected':''}" data-filter="all" aria-pressed="${rosterFilter==='all'}">All students<span class="number">18</span></button><button class="filter-tab ${rosterFilter==='attention'?'selected':''}" data-filter="attention" aria-pressed="${rosterFilter==='attention'}">Needs attention<span class="number">${attention}</span></button></div><label class="search-field">${icon('search')}<input id="student-search" type="search" placeholder="Search students…" aria-label="Search students" value="${escape(rosterSearch)}"></label></div><div class="table-scroll"><table><thead><tr><th>Student</th><th><button data-action="sort">Words learned ${icon('chevron')}</button></th><th>Weekly goal</th><th>Accuracy</th><th>Last activity</th><th>Status</th></tr></thead><tbody id="student-rows"></tbody></table></div><div class="table-footer"><span id="table-summary"></span><div class="pagination" id="pagination"></div></div></section>`;
  }
  function filteredStudents() {
    return state.students.filter(student => (rosterFilter !== 'attention' || needsHelp(student)) && student.name.toLowerCase().includes(rosterSearch.toLowerCase())).sort((a,b)=>sortDescending ? b.learned-a.learned : a.learned-b.learned);
  }
  function renderRows() {
    if (!$('student-rows')) return;
    const students = filteredStudents(), perPage = 6, pages = Math.max(1,Math.ceil(students.length/perPage));
    rosterPage = Math.min(rosterPage,pages);
    const visible = students.slice((rosterPage-1)*perPage,rosterPage*perPage);
    $('student-rows').innerHTML = visible.map(student=>`<tr data-student="${student.id}" tabindex="0" aria-label="View ${escape(student.name)}’s progress"><td><div class="student-name">${avatar(student)}<div><strong>${escape(student.name)}</strong><small>${student.streak ? `${student.streak}-day study streak` : 'Building a study habit'}</small></div></div></td><td><div class="table-progress"><div class="nums">${student.learned}<span>/ 570</span></div><div class="progress-track"><span style="width:${percentage(student)}%"></span></div></div></td><td><div class="weekly"><strong>${student.weekly}</strong><small> / ${state.goal} words</small><div class="weekly-meter">${Array.from({length:5},(_,i)=>`<span class="${student.weekly/state.goal*5>i?'filled':''}"></span>`).join('')}</div></div></td><td><span class="accuracy ${student.accuracy>=85?'good':student.accuracy<75?'low':''}">${student.accuracy}%</span></td><td>${escape(student.last)}</td><td>${status(student)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-table">No students match your search.</td></tr>';
    $('table-summary').textContent = students.length ? `Showing ${(rosterPage-1)*perPage+1}–${Math.min(rosterPage*perPage,students.length)} of ${students.length} students` : '0 students';
    $('pagination').innerHTML = `<button class="word" data-page="${rosterPage-1}" ${rosterPage===1?'disabled':''}>Previous</button>${Array.from({length:pages},(_,i)=>`<button class="${rosterPage===i+1?'active':''}" data-page="${i+1}" aria-label="Page ${i+1}" ${rosterPage===i+1?'aria-current="page"':''}>${i+1}</button>`).join('')}<button class="word" data-page="${rosterPage+1}" ${rosterPage===pages?'disabled':''}>Next</button>`;
  }
  function troubleWords() {
    const words = [['ambiguous',42],['coherence',38],['criteria',35],['inherent',31]];
    return `<section class="panel"><div class="panel-head"><div><h2>Words to review together</h2><p class="panel-subtitle">A few tricky words for your next lesson</p></div></div><div class="trouble-words">${words.map(([word,missed])=>`<button class="word-chip" data-word="${word}">${word}<span>${missed}% missed</span></button>`).join('')}</div></section>`;
  }
  function supportPanel() {
    const count = state.students.filter(needsHelp).length;
    return `<section class="panel"><div class="panel-head"><h2>A little support goes a long way</h2></div><div class="support-body"><div class="support-icon">${icon('users')}</div><div><strong>${count} students could use a check-in</strong><p>Low recall or a few days away from practice.</p></div><button class="text-link" data-action="show-attention">View students</button></div></section>`;
  }
  function overview() {
    return `${heading('A clear view of your class.', 'One shared deck. Every student’s own pace.',teacherActions())}${metrics()}<div class="middle-grid">${learningChart()}${focusCard()}</div>${rosterPanel()}<div class="bottom-grid">${troubleWords()}${supportPanel()}</div>`;
  }
  function assignmentsView() {
    return `${heading('Small goals. Steady progress.', 'Give your class a manageable part of the 570-word deck.',`<button class="button primary" data-action="new-assignment">${icon('plus')}New assignment</button>`)}<div class="assignment-list">${state.assignments.map(assignment=>`<article class="panel assignment-card"><div class="book-cover">${icon('book')}</div><div class="assignment-summary"><span class="badge ${assignment.type==='Active'?'blue':''}">${assignment.type}</span><h2>${escape(assignment.title)}</h2><p>Academic Word List · Words ${assignment.start}–${assignment.start+assignment.count-1} · Due ${formatDate(assignment.due)}</p></div><div class="assignment-completion"><p>${assignment.complete} of 18 students completed</p><div class="progress-track"><span style="width:${assignment.complete/18*100}%"></span></div></div><button class="button" data-assignment="${assignment.id}">View progress</button></article>`).join('')}</div><section class="panel" style="margin-top:22px"><div class="report-note">${icon('info')}<p>Every assignment comes from the same 570-word deck. Students keep their progress as you move from one weekly goal to the next.</p></div></section>`;
  }
  function deckView() {
    return `${heading('The words you’ll grow with.', 'A shared foundation for stronger academic English.')}<section class="panel large-deck"><div class="large-book"><small>WORDS STUDIO</small><strong>Academic<br>Word List</strong><span>570 words</span></div><div class="deck-description"><h2>Academic Word List</h2><p>All 570 words from your original deck, with clear definitions and dictionary example sentences. One consistent collection for the whole class.</p><div class="deck-tags"><span class="badge">570 words</span><span class="badge">Dictionary examples</span><span class="badge">Class deck</span></div></div></section><div class="deck-controls"><label class="search-field">${icon('search')}<input id="deck-search" type="search" placeholder="Find a word or definition…" aria-label="Search the 570-word deck" value="${escape(deckSearch)}"></label><span class="deck-count" id="deck-count"></span></div><div class="word-grid" id="word-grid"></div><div class="load-more"><button class="button" id="more-words" data-action="more-words">Show more words</button></div>`;
  }
  function renderWords() {
    const words = deck.filter(entry=>(entry.word+' '+entry.hint).toLowerCase().includes(deckSearch.toLowerCase()));
    $('deck-count').textContent = `${words.length} ${words.length===1?'word':'words'}`;
    $('word-grid').innerHTML = words.slice(0,wordLimit).map(entry=>`<button class="word-card" data-word="${escape(entry.word)}"><div class="word-card-top"><h3>${escape(entry.word)}</h3><small>${escape(entry.pos || 'word')}</small></div><p>${escape(entry.hint)}</p></button>`).join('') || '<p class="empty-table">No words match your search.</p>';
    $('more-words').hidden = words.length <= wordLimit;
  }
  function heatmap() {
    return `<section class="panel"><div class="panel-head"><div><h2>Practice consistency</h2><p class="panel-subtitle">A little practice every day builds a lasting habit</p></div><span class="badge">11–24 November</span></div><div class="heatmap-scroll"><div class="heatmap"><span></span>${Array.from({length:14},(_,i)=>`<span class="heatmap-date">${i+11}</span>`).join('')}${state.students.map(student=>`<button class="heatmap-label" data-student="${student.id}">${escape(student.name)}</button>${Array.from({length:14},(_,i)=>{const v=student.daysAgo>13-i?0:(student.id*13+i*7)%5;return `<button class="heatmap-cell" data-level="${v}" data-activity="${student.id},${i}" aria-label="${escape(student.name)}, ${i+11} November, ${v*6} words reviewed" title="${v*6} words reviewed">${v*6}</button>`;}).join('')}`).join('')}</div></div><div class="heatmap-legend">Less<span style="background:#f2f1fa"></span><span style="background:#e2dffb"></span><span style="background:#bcb7f5"></span><span style="background:#8d85eb"></span><span style="background:#5a51da"></span>More</div></section>`;
  }
  function reportsView() {
    return `${heading('Look beyond the numbers.', 'See the habits and tricky words behind your class’s progress.',`<button class="button" data-action="export">${icon('download')}Export report</button>`)}${metrics()}${heatmap()}<div class="bottom-grid">${troubleWords()}${supportPanel()}</div>`;
  }
  function studentView() {
    const student = currentStudent(), assignment = currentAssignment(), remaining = Math.max(0,state.goal-student.weekly);
    return `${heading(`A few words closer, ${escape(student.name.split(' ')[0])}.`, `Your progress in ${escape(state.className)} · Academic Word List`)}<section class="student-hero"><div><span class="section-label" style="color:#8b84bf">YOUR WEEKLY GOAL</span><h2>${remaining ? `${remaining} more words. You’ve got this.` : 'Your weekly goal, complete.'}</h2><p>Build your vocabulary one short session at a time.</p><button class="button primary" data-action="practice">${icon('book')}Continue practice</button></div><div class="goal-ring" style="--angle:${Math.min(100,student.weekly/state.goal*100)*3.6}deg"><div><strong>${student.weekly}<small style="display:inline;font-size:.85rem"> / ${state.goal}</small></strong><small>words this week</small></div></div></section><div class="metrics-grid">${metric('Words learned',`${student.learned}<small>/ 570</small>`,`${percentage(student)}% of your deck`,'book')}${metric('Recall accuracy',`${student.accuracy}<small>%</small>`,'Keep making those connections','checkcircle',false)}${metric('Study streak',`${student.streak}<small>days</small>`,'One session makes a difference','flame',false)}${metric('Still to explore',String(570-student.learned),'A little more each day','layers',false)}</div><div class="student-two-cols"><section class="panel"><div class="panel-head"><h2>Your next steps</h2><span class="badge blue">Class assignment</span></div><div class="next-step"><h3>${escape(assignment.title)}</h3><p>Words ${assignment.start}–${assignment.start+assignment.count-1} from your Academic Word List.<br>Due ${formatDate(assignment.due)}. You can practice at your own pace.</p><button class="button" data-action="practice">Start a short session</button></div></section><section class="panel"><div class="panel-head"><h2>Keep the momentum</h2></div><div class="milestone-body"><div class="milestone-icon">${icon('medal')}</div><div><h3>${Math.floor(student.learned/50)*50} words and counting</h3><p>Your next milestone is ${Math.min(570,(Math.floor(student.learned/50)+1)*50)} words. Every small session counts.</p></div></div></section></div><div class="section-heading"><h2>A few words to revisit</h2><button class="text-link" data-go="deck">Browse the deck</button></div><div class="word-grid">${['ambiguous','coherence','inherent'].map(word=>deck.find(entry=>entry.word===word)).filter(Boolean).map(entry=>`<button class="word-card" data-word="${entry.word}"><div class="word-card-top"><h3>${entry.word}</h3><span class="badge">Review</span></div><p>${escape(entry.hint)}</p></button>`).join('')}</div>`;
  }
  function render() {
    const viewName = {overview:'Overview',students:'Students',assignments:'Assignments',deck:'Word deck',reports:'Reports'}[currentView] || 'Overview';
    $('breadcrumb-page').textContent = role==='student' ? 'My learning' : viewName;
    $('breadcrumb-class').textContent = state.className;
    $('workspace-name').textContent = state.className;
    $('navigation').innerHTML = role==='teacher' ? teacherNavigation : `<a href="#overview" data-student-nav="overview">${icon('book')}My learning</a><a href="#deck" data-student-nav="deck">${icon('layers')}Word deck<span class="nav-count">570</span></a>`;
    document.querySelector('.nav-label').textContent = role==='teacher'?'TEACHING':'LEARNING';
    $('class-settings').querySelector('small').textContent = role==='teacher'?'Class workspace':'Your English class';
    $('profile-button').innerHTML = role==='teacher' ? teacherProfile : `${avatar(currentStudent())}<span><strong>${escape(currentStudent().name)}</strong><small>Student</small></span>`;
    hydrateIcons($('navigation'));hydrateIcons($('profile-button'));
    $('teacher-role').classList.toggle('selected',role==='teacher'); $('student-role').classList.toggle('selected',role==='student');
    $('teacher-role').setAttribute('aria-pressed',String(role==='teacher')); $('student-role').setAttribute('aria-pressed',String(role==='student'));
    document.querySelectorAll('[data-nav],[data-student-nav]').forEach(link=>{const active=(link.dataset.nav||link.dataset.studentNav)===currentView;link.classList.toggle('active',active); if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    if(role==='student'&&currentView!=='deck') $('main').innerHTML=studentView();
    else if(currentView==='students') $('main').innerHTML=`${heading('Every learner, in focus.', 'Follow individual progress through the same 570-word deck.',teacherActions())}${rosterPanel(true)}`;
    else $('main').innerHTML=({overview,assignments:assignmentsView,deck:deckView,reports:reportsView}[currentView] || overview)();
    renderRows(); if(currentView==='deck')renderWords();
  }
  function navigate(view) {
    currentView = ['overview','students','assignments','deck','reports'].includes(view)?view:'overview';
    if(role==='student'&&currentView!=='deck')currentView='overview';
    rosterPage=1;
    $('sidebar').classList.remove('open'); $('mobile-menu').setAttribute('aria-expanded','false'); $('modal-backdrop').hidden=true;
    render(); window.scrollTo({top:0,behavior:'instant'});
  }
  function showStudent(id) {
    const student=state.students.find(s=>s.id===Number(id)); if(!student)return;
    const unlearned=570-student.learned-student.learning;
    dialog('Student progress',`<div class="dialog-body"><div class="student-detail-top">${avatar(student)}<div><h3>${escape(student.name)}</h3><p>${escape(state.className)} · ${status(student)}</p></div></div><div class="detail-metrics"><div><strong>${student.learned}<small> / 570</small></strong><span>Words learned</span></div><div><strong>${student.accuracy}%</strong><span>Recall accuracy</span></div><div><strong>${student.streak} days</strong><span>Study streak</span></div></div><p class="detail-label">A shared deck. Individual progress.</p><div class="stacked-track"><span class="learned" style="width:${student.learned/570*100}%"></span><span class="learning" style="width:${student.learning/570*100}%"></span></div><div class="detail-progress-key"><span>${student.learned} learned</span><span>${student.learning} learning</span><span>${Math.max(0,unlearned)} new</span></div><p class="detail-label">Practice over the last 7 days</p><div class="student-detail-chart">${['W','T','F','S','S','M','T'].map((label,i)=>`<div><span style="height:${student.daysAgo>6-i?0:20+(student.id*7+i*11)%65}%"></span><small>${label}</small></div>`).join('')}</div><p class="detail-label">Words to revisit</p><div class="trouble-words" style="padding:0">${['ambiguous','criteria','inherent'].map(word=>`<button class="word-chip" data-word="${word}">${word}</button>`).join('')}</div><p class="info-note">Last practice: ${escape(student.last)}. These are sample results for this design preview.</p></div>`,`<button class="button" data-student-preview="${student.id}">Preview student view</button><button class="button primary" data-action="close-dialog">Done</button>`);
  }
  function showWord(word) {
    const entry=deck.find(item=>item.word===word); if(!entry)return;
    const definition=entry.definition_data?.meanings?.flatMap(meaning=>meaning.definitions||[]).find(item=>item.example?.trim()) || {};
    const source=entry.dictionary_source==='cambridge'?'Cambridge Dictionary':'Free Dictionary API';
    dialog('From your class deck',`<div class="dialog-body"><span class="badge blue">Academic Word List · 570 words</span><h3 class="word-detail-heading">${escape(entry.word)}</h3><p class="phonetic">${escape(entry.phonetic||entry.pos||'')}</p><p class="word-definition">${escape(entry.hint)}</p>${definition.example?`<blockquote class="example-sentence">${escape(definition.example)}</blockquote>`:''}<a class="source-link" href="${escape(entry.dictionary_url||'https://dictionaryapi.dev/')}" target="_blank" rel="noopener">Example from ${source}</a></div>`,`<button class="button primary" data-action="close-dialog">Back to class</button>`);
  }
  function showAssignment(id) {
    const assignment=state.assignments.find(item=>item.id===Number(id)); if(!assignment)return;
    const assigned=deck.slice(assignment.start-1,assignment.start-1+assignment.count);
    dialog('Assignment details',`<div class="dialog-body"><span class="badge blue">${assignment.type}</span><h3 style="font-size:1.35rem;margin:15px 0 9px">${escape(assignment.title)}</h3><p>Academic Word List · ${assignment.count} words<br>Due ${formatDate(assignment.due)} · ${assignment.complete} of 18 students completed</p><div class="progress-track" style="margin:20px 0"><span style="width:${assignment.complete/18*100}%"></span></div><p class="detail-label">The words in this assignment</p><div class="trouble-words" style="padding:0">${assigned.map(entry=>`<button class="word-chip" data-word="${entry.word}">${entry.word}</button>`).join('')}</div><p class="info-note">This is a design preview. Assignment completion uses sample class data.</p></div>`,`<button class="button primary" data-action="close-dialog">Done</button>`);
  }
  function newAssignment() {
    dialog('Set a small, achievable goal',`<form class="dialog-body" id="assignment-form"><p>Choose a part of the shared Academic Word List for the class to practice.</p><label class="dialog-field">Assignment name<input name="title" placeholder="e.g. This week’s academic vocabulary" maxlength="80" required></label><div class="dialog-row"><label class="dialog-field">Starting word<input name="start" type="number" min="1" max="570" value="236" required></label><label class="dialog-field">Number of words<input name="count" type="number" min="1" max="570" value="35" required></label></div><label class="dialog-field">Due date<input name="due" type="date" value="2026-12-04" required></label><p class="info-note">The assignment will appear in this browser’s design preview.</p><p class="inline-error" id="assignment-error" hidden></p></form>`,`<button class="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit" form="assignment-form">Create assignment</button>`);
  }
  function classSettings() {
    dialog('Your classroom',`<form class="dialog-body" id="class-form"><label class="dialog-field">Class name<input name="name" value="${escape(state.className)}" maxlength="40" required></label><label class="dialog-field">Weekly word goal<input name="goal" type="number" min="5" max="100" value="${state.goal}" required></label><p class="info-note">Changes are saved only to this design preview on your device.</p></form>`,`<button class="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit" form="class-form">Save changes</button>`);
  }
  function showReferences() {
    dialog('A classroom-first direction',`<div class="dialog-body"><p>This interactive design uses a sample class of 18 students and your real 570-word Academic Word List. The teacher and student views share the same local preview activity.</p><div class="reference-list"><a href="https://quizlet.com/features/teacher-class-progress" target="_blank" rel="noopener"><strong>Quizlet Class Progress</strong><span>Student rosters, clear progress states, and a focused blue-and-white workspace.</span></a><a href="https://www.vocabulary.com/articles/announcements/announcing-the-powerful-new-teacher-dashboard/" target="_blank" rel="noopener"><strong>Vocabulary.com Teacher Dashboard</strong><span>Class activity, individual progress, and difficult words to review together.</span></a><a href="https://knowt.com/teachers" target="_blank" rel="noopener"><strong>Knowt for Teachers</strong><span>Classroom navigation and student-level analytics.</span></a></div><p class="info-note">Student names and activity are fictional. No accounts are created and no class invitations or messages are sent. This preview is separate from your current learning app.</p></div>`,`<button class="button" data-action="reset">Reset sample data</button><button class="button primary" data-action="close-dialog">Got it</button>`);
  }
  function invite() {
    dialog('Bring your class together',`<div class="dialog-body"><p>One class link. One 570-word deck. Every student gets a clear place to practice.</p><div class="join-code">WORD–B2</div><p class="info-note">In this design preview, the link opens Maya’s student view. Real student accounts and shared classroom storage will be connected in the next implementation stage.</p></div>`,`<button class="button" data-action="copy-invite">${icon('copy')}Copy preview link</button><button class="button primary" data-student-preview="1">Open student preview</button>`);
  }
  function exportReport() {
    const rows=[['Student','Learned out of 570','Weekly words','Weekly goal','Recall accuracy','Last active','Status'],...state.students.map(s=>[s.name,s.learned,s.weekly,state.goal,s.accuracy+'%',s.last,needsHelp(s)?'Needs attention':'On track'])];
    const csv=rows.map(row=>row.map(cell=>'"'+String(cell).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download='words-studio-sample-class-report.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Sample class report downloaded');
  }
  function startPractice() {
    const student=currentStudent();practice={studentId:student.id,index:Math.min(student.learned,deck.length-1),count:0,revealed:false};renderPractice();
  }
  function renderPractice() {
    if(!practice)return;
    const student=currentStudent(),entry=deck[practice.index%deck.length];
    if(practice.count>=5){dialog('A little stronger already',`<div class="practice-card"><div class="practice-complete">${icon('checkcircle')}</div><h3 style="font-size:1.5rem">Five words. One good habit.</h3><p class="info-note">Your practice is now visible in the teacher’s preview.<br>${escape(student.name)} has learned ${student.learned} of 570 words.</p></div>`,`<button class="button" data-action="practice-teacher">See teacher view</button><button class="button primary" data-action="close-dialog">Finish session</button>`);return;}
    const example=entry.definition_data?.meanings?.flatMap(m=>m.definitions||[]).find(d=>d.example?.trim())?.example;
    dialog('A short practice session',`<div class="practice-card"><span class="practice-counter">Word ${practice.count+1} of 5 · ${escape(student.name)}</span><h3 class="word-detail-heading">${escape(entry.word)}</h3>${practice.revealed?`<p class="word-definition">${escape(entry.hint)}</p>${example?`<blockquote class="example-sentence">${escape(example)}</blockquote>`:''}<div class="practice-buttons"><button class="button" data-review="again">Review again</button><button class="button primary" data-review="remembered">${icon('check')}Remembered</button></div>`:`<p class="phonetic">${escape(entry.phonetic||'')}</p><div class="practice-buttons"><button class="button primary" data-action="reveal">Show meaning</button></div>`}</div>`);
  }
  function review(answer) {
    if(!practice||!practice.revealed)return;
    const student=currentStudent(),entry=deck[practice.index%deck.length];
    if(answer==='remembered'&&!student.reviewedWords.includes(entry.word)){
      student.reviewedWords.push(entry.word);student.learned=Math.min(570,student.learned+1);student.weekly++;student.last='Just now';student.daysAgo=0;student.streak=Math.max(1,student.streak);
    }
    practice.index++;practice.count++;practice.revealed=false;save();render();renderPractice();
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,a,tr[data-student]');if(!target)return;
    if(target.dataset.nav){role='teacher';navigate(target.dataset.nav);return;}
    if(target.dataset.studentNav){navigate(target.dataset.studentNav);return;}
    if(target.dataset.go){currentView=target.dataset.go;if(currentView!=='deck')role='teacher';location.hash=currentView;navigate(currentView);return;}
    if(target.dataset.student){showStudent(target.dataset.student);return;}
    if(target.dataset.word){showWord(target.dataset.word);return;}
    if(target.dataset.assignment){showAssignment(target.dataset.assignment);return;}
    if(target.dataset.studentPreview){selectedStudent=Number(target.dataset.studentPreview);role='student';closeDialog();navigate('overview');return;}
    if(target.dataset.review){review(target.dataset.review);return;}
    if(target.dataset.filter){rosterFilter=target.dataset.filter;rosterPage=1;document.querySelectorAll('[data-filter]').forEach(button=>{button.classList.toggle('selected',button===target);button.setAttribute('aria-pressed',String(button===target));});renderRows();return;}
    if(target.dataset.page){rosterPage=Number(target.dataset.page);renderRows();return;}
    if(target.dataset.activity){const [id,day]=target.dataset.activity.split(',').map(Number);const s=state.students.find(item=>item.id===id);toast(`${s.name} · ${day+11} November · sample practice activity`);return;}
    switch(target.id){
      case 'teacher-role':role='teacher';navigate('overview');return;
      case 'student-role':role='student';navigate('overview');return;
      case 'references-button':showReferences();return;
      case 'profile-button':role==='teacher'?classSettings():showStudent(selectedStudent);return;
      case 'class-settings':role==='teacher'?classSettings():showAssignment(currentAssignment().id);return;
      case 'mobile-menu':{const open=$('sidebar').classList.toggle('open');target.setAttribute('aria-expanded',String(open));$('modal-backdrop').hidden=!open;return;}
    }
    switch(target.dataset.action){
      case 'close-dialog':closeDialog();break;
      case 'export':exportReport();break;
      case 'invite':invite();break;
      case 'new-assignment':newAssignment();break;
      case 'sort':sortDescending=!sortDescending;renderRows();break;
      case 'show-attention':role='teacher';rosterFilter='attention';rosterSearch='';navigate('students');break;
      case 'more-words':wordLimit+=18;renderWords();break;
      case 'practice':startPractice();break;
      case 'reveal':if(practice){practice.revealed=true;renderPractice();}break;
      case 'practice-teacher':role='teacher';closeDialog();navigate('overview');showStudent(selectedStudent);break;
      case 'copy-invite':{const url=new URL(location.href);url.search='?view=student';url.hash='';navigator.clipboard.writeText(url.href).then(()=>toast('Student preview link copied')).catch(()=>toast('Open the student preview and copy the address to share it.'));break;}
      case 'reset':if(confirm('Reset only this design preview’s sample data? Your learning app is not affected.')){state=defaultState();save();closeDialog();role='teacher';rosterFilter='all';rosterSearch='';navigate('overview');toast('Sample classroom reset');}break;
    }
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='student-search'){rosterSearch=event.target.value;rosterPage=1;renderRows();}
    if(event.target.id==='deck-search'){deckSearch=event.target.value;wordLimit=18;renderWords();}
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='period-select'){period=event.target.value;render();}
    if(event.target.id==='roster-sort'){sortDescending=event.target.value==='desc';rosterPage=1;renderRows();}
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='assignment-form'){
      event.preventDefault();const form=new FormData(event.target);const start=Number(form.get('start')),count=Number(form.get('count'));
      if(start+count-1>570){$('assignment-error').textContent='This range goes beyond word 570. Choose fewer words or an earlier start.';$('assignment-error').hidden=false;return;}
      state.assignments.unshift({id:Math.max(...state.assignments.map(item=>item.id))+1,title:String(form.get('title')).trim(),start,count,due:String(form.get('due')),type:'Active',complete:0});save();closeDialog();navigate('assignments');toast('Assignment added to the design preview');
    }
    if(event.target.id==='class-form'){
      event.preventDefault();const form=new FormData(event.target);state.className=String(form.get('name')).trim();state.goal=Number(form.get('goal'));save();closeDialog();render();toast('Classroom preview updated');
    }
  });
  document.addEventListener('keydown',event=>{
    const row=event.target.closest('tr[data-student]');if(row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showStudent(row.dataset.student);}
    if(event.key==='Escape'){$('sidebar').classList.remove('open');$('mobile-menu').setAttribute('aria-expanded','false');$('modal-backdrop').hidden=true;}
  });
  $('dialog').addEventListener('click',event=>{if(event.target===$('dialog')){const r=$('dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
  $('modal-backdrop').addEventListener('click',()=>{$('sidebar').classList.remove('open');$('mobile-menu').setAttribute('aria-expanded','false');$('modal-backdrop').hidden=true;});
  window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)||'overview'));
  hydrateIcons();
  fetch('./academic_words.json').then(response=>{if(!response.ok)throw Error('Word deck unavailable');return response.json();}).then(data=>{
    if(data.length!==570)throw Error('Expected 570 academic words');deck=data;
    if(new URLSearchParams(location.search).get('view')==='student')role='student';
    navigate(location.hash.slice(1)||'overview');
  }).catch(()=>{$('main').innerHTML=`<section class="panel" style="padding:40px"><h1>The word deck couldn’t load.</h1><p style="margin:20px 0">Refresh the page to try again.</p><button class="button primary" id="reload-preview">Try again</button></section>`;$('reload-preview').onclick=()=>location.reload();});
})();
