(function () {
  'use strict';

  const QUESTIONS = Array.isArray(window.QUESTIONS) ? window.QUESTIONS.filter(Boolean) : [];
  const QUESTION_MAP = new Map(QUESTIONS.map((q) => [q.id, q]));
  const STORAGE_KEY = 'stepwise.v1';
  const DAILY_TARGET = 10;
  const SUBJECTS = [
    { name: '马原', mark: '马' },
    { name: '毛中特', mark: '毛' },
    { name: '史纲', mark: '史' },
    { name: '思修法基', mark: '思' },
    { name: '时政', mark: '时' }
  ];

  const app = document.getElementById('app');

  let sheetOpen = false;
  let dialogOpen = false;
  let wrongFilter = { subject: 'all', tag: 'all', scopeIds: null };
  let wrongBookReturn = 'home';
  let expandedWrong = new Set();
  let clearConfirmOpen = false;
  let toastEl = null;
  let toastTimer = null;
  let data = loadData();

  sanitizeProgress();

  function defaultData() {
    return {
      wrongBook: [],
      checkins: [],
      stats: {},
      today: { date: '', count: 0 },
      progress: null,
      lastResult: null
    };
  }

  function normalize(raw) {
    const next = defaultData();
    if (!raw || typeof raw !== 'object') return next;
    const wrongSource = Array.isArray(raw.wrongBook)
      ? raw.wrongBook
      : (Array.isArray(raw.wrongIds) ? raw.wrongIds : []);
    next.wrongBook = normalizeWrongBook(wrongSource);
    if (Array.isArray(raw.checkins)) next.checkins = raw.checkins.filter((d) => typeof d === 'string');
    if (raw.stats && typeof raw.stats === 'object') next.stats = raw.stats;
    if (raw.today && typeof raw.today === 'object') {
      next.today = {
        date: typeof raw.today.date === 'string' ? raw.today.date : '',
        count: Number(raw.today.count) || 0
      };
    }
    if (raw.progress && typeof raw.progress === 'object') next.progress = raw.progress;
    if (raw.lastResult && typeof raw.lastResult === 'object') next.lastResult = raw.lastResult;
    return next;
  }

  function normalizeWrongBook(source) {
    const seen = new Set();
    const list = [];
    source.forEach((item) => {
      let entry = null;
      if (typeof item === 'string') {
        entry = { id: item, wrongCount: 1, lastWrongAt: 0, lastAnswer: [] };
      } else if (item && typeof item === 'object' && typeof item.id === 'string') {
        entry = {
          id: item.id,
          wrongCount: Math.max(1, Number(item.wrongCount) || 1),
          lastWrongAt: Number(item.lastWrongAt) || 0,
          lastAnswer: Array.isArray(item.lastAnswer) ? item.lastAnswer.map(String) : []
        };
      }
      if (!entry || !QUESTION_MAP.has(entry.id) || seen.has(entry.id)) return;
      seen.add(entry.id);
      list.push(entry);
    });
    return list;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return normalize(JSON.parse(raw));
    } catch (err) {
      return defaultData();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      /* storage unavailable */
    }
  }

  function sanitizeProgress() {
    const p = data.progress;
    if (!p || !Array.isArray(p.ids)) {
      data.progress = null;
      return;
    }
    p.ids = p.ids.filter((id) => QUESTION_MAP.has(id));
    if (!p.ids.length) {
      data.progress = null;
      return;
    }
    p.index = Math.max(0, Math.min(Number(p.index) || 0, p.ids.length - 1));
    p.elapsedMs = Number(p.elapsedMs) || 0;
    p.timerStartedAt = Date.now();
    p.pendingMap = (p.pendingMap && typeof p.pendingMap === 'object') ? p.pendingMap : {};
    delete p.pending;
    if (!p.answers || typeof p.answers !== 'object') p.answers = {};
  }

  function todayKey(date) {
    const d = date || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function ensureToday() {
    const key = todayKey();
    if (!data.today || data.today.date !== key) {
      data.today = { date: key, count: 0 };
    }
  }

  function calcStreak() {
    const marks = new Set(data.checkins);
    const cursor = new Date();
    if (!marks.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let days = 0;
    while (marks.has(todayKey(cursor)) && days < 3650) {
      days += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return days;
  }

  function validWrongRecords() {
    return data.wrongBook.filter((record) => record && QUESTION_MAP.has(record.id));
  }

  function wrongBookTotal() {
    return validWrongRecords().length;
  }

  function getWrongRecord(id) {
    return data.wrongBook.find((record) => record.id === id) || null;
  }

  function answerKeys(q) {
    return Array.isArray(q.answer) ? q.answer.map(String) : [];
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const left = a.slice().sort();
    const right = b.slice().sort();
    return left.every((v, i) => v === right[i]);
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[ch];
    });
  }

  function formatDuration(ms) {
    let sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(sec / 3600);
    sec -= h * 3600;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function toast(message) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
    }, 2200);
  }

  function currentQuestion() {
    const p = data.progress;
    if (!p) return null;
    return QUESTION_MAP.get(p.ids[p.index]) || null;
  }

  function touchTimer() {
    const p = data.progress;
    if (!p || !p.timerStartedAt) return;
    const now = Date.now();
    p.elapsedMs = (Number(p.elapsedMs) || 0) + Math.max(0, now - p.timerStartedAt);
    p.timerStartedAt = now;
  }

  function saveProgress() {
    touchTimer();
    persist();
  }

  function go(view) {
    const target = `#/${view}`;
    if (location.hash === target) render();
    else location.hash = target;
  }

  function currentView() {
    const match = (location.hash || '').match(/^#\/([a-z]+)/);
    const view = match ? match[1] : 'home';
    return view === 'quiz' || view === 'result' || view === 'wrongbook' ? view : 'home';
  }

  function render(keepScroll) {
    const y = keepScroll ? window.scrollY : 0;
    let view = currentView();
    if (view === 'quiz' && (!data.progress || !currentQuestion())) {
      view = 'home';
      history.replaceState(null, '', '#/home');
    }
    if (view === 'result' && !data.lastResult) {
      view = 'home';
      history.replaceState(null, '', '#/home');
    }
    if (view !== 'home') dialogOpen = false;
    if (view !== 'wrongbook') clearConfirmOpen = false;
    if (!QUESTIONS.length) {
      app.innerHTML = '<div class="empty">题库未加载，请检查 js/questions.js 是否存在且格式正确。</div>';
      return;
    }
    if (view === 'quiz') app.innerHTML = renderQuiz();
    else if (view === 'result') app.innerHTML = renderResult();
    else if (view === 'wrongbook') app.innerHTML = renderWrongBook();
    else app.innerHTML = renderHome();
    if (keepScroll) window.scrollTo(0, y);
    else window.scrollTo(0, 0);
  }

  function clearFinishedSession() {
    const p = data.progress;
    const r = data.lastResult;
    if (p && r && p.startedAt && p.startedAt <= r.finishedAt) {
      data.progress = null;
      persist();
    }
  }

  function renderHome() {
    clearFinishedSession();
    ensureToday();
    const count = data.today.count;
    const pct = Math.min(100, Math.round((count / DAILY_TARGET) * 100));
    const streak = calcStreak();
    const wrongCount = wrongBookTotal();
    const left = Math.max(0, DAILY_TARGET - count);
    const inProgress = data.progress && data.progress.ids.length ? data.progress : null;
    const step = inProgress ? inProgress.index + 1 : 0;
    const cards = SUBJECTS.map((subject) => {
      const total = QUESTIONS.filter((q) => q.subject === subject.name).length;
      const stat = data.stats[subject.name] || { answered: 0, correct: 0 };
      const rate = stat.answered ? `${Math.round((stat.correct / stat.answered) * 100)}%` : '—';
      const rateClass = stat.answered ? (stat.correct / stat.answered >= 0.6 ? ' is-high' : ' is-low') : '';
      return `<button type="button" class="subject-card" data-action="subject" data-subject="${esc(subject.name)}">
        <span class="subject-mark">${subject.mark}</span>
        <span class="subject-info">
          <b>${esc(subject.name)}</b>
          <small>${total} 题</small>
        </span>
        <span class="subject-rate">
          <b class="rate${rateClass}">${rate}</b>
          <small>正确率</small>
        </span>
        <span class="chev">›</span>
      </button>`;
    }).join('');
    const dialog = dialogOpen ? `<div class="dialog-mask" data-action="dialog-cancel"></div>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="restart-title">
        <h2 id="restart-title">重新开始</h2>
        <p>重新开始会清空这组答题进度,已答的题仍计入统计。</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-action="resume">继续上次</button>
          <button type="button" class="btn btn-primary" data-action="restart-confirm">重新开始</button>
        </div>
      </section>` : '';

    return `<div class="home">
      <header class="home-head">
        <div class="brand">
          <span class="brand-mark">步</span>
          <div>
            <h1 class="brand-title">步步为政</h1>
            <p class="brand-sub">StepWise · 考研政治刷题</p>
          </div>
        </div>
      </header>

      <section class="card today-card">
        <div class="today-head">
          <span class="card-label">今日进度</span>
          <span class="streak">连续打卡 ${streak} 天</span>
        </div>
        <div class="today-main">
          <strong class="today-num">${count}</strong>
          <div class="today-meta">
            <p>已刷 <b>${count}</b> 题 / 今日目标 ${DAILY_TARGET} 题</p>
            <p>${left > 0 ? `还差 ${left} 题完成今日目标` : '今日目标已完成，保持节奏'}</p>
          </div>
        </div>
        <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
          <i style="width:${pct}%"></i>
        </div>
      </section>

      <div class="cta">
        <button type="button" class="btn btn-primary btn-lg" data-action="${inProgress ? 'resume' : 'daily'}">${inProgress ? `继续第 ${step} 步` : '今日十题'}</button>
        ${inProgress ? '<button type="button" class="restart-link" data-action="restart">重新开始</button>' : ''}
        <button type="button" class="btn btn-ghost btn-lg" data-action="wrongbook">
          错题重刷
          <span class="pill${wrongCount ? '' : ' is-empty'}">${wrongCount}</span>
        </button>
      </div>

      <section class="subjects">
        <div class="section-head">
          <h2>五大板块</h2>
          <span>正确率按累计作答计算</span>
        </div>
        <div class="subject-list">${cards}</div>
      </section>

      <div class="home-foot">题库 ${QUESTIONS.length} 题 · 数据仅保存在本机浏览器</div>
      ${dialog}
    </div>`;
  }

  function renderQuiz() {
    const p = data.progress;
    const q = currentQuestion();
    if (!p || !q) return '';

    const answered = p.answers[q.id];
    const pending = (p.pendingMap && p.pendingMap[q.id]) || [];
    const chosen = answered ? answered.selected : pending;
    const keys = answerKeys(q);
    const total = p.ids.length;
    const step = p.index + 1;
    const pct = Math.round((step / total) * 100);
    const isMulti = q.type === 'multiple';

    const options = q.options.map((option) => {
      let cls = 'option';
      if (answered) {
        if (keys.includes(option.key)) cls += ' is-correct';
        else if (answered.selected.includes(option.key)) cls += ' is-wrong';
      } else if (chosen.includes(option.key)) {
        cls += ' is-selected';
      }
      return `<button type="button" class="${cls}" data-action="option" data-key="${esc(option.key)}"${answered ? ' disabled' : ''}>
        <span class="opt-key">${esc(option.key)}</span>
        <span class="opt-text">${esc(option.text)}</span>
      </button>`;
    }).join('');

    const explain = answered
      ? `<section class="explain ${answered.correct ? 'is-ok' : 'is-bad'}">
          <div class="explain-head">
            <span class="answer-badge">正确答案 ${keys.join('、')}</span>
            <span class="verdict ${answered.correct ? 'ok' : 'bad'}">${answered.correct ? '回答正确' : '回答错误'}</span>
          </div>
          <p class="explain-text">${esc(q.explain)}</p>
          <span class="tag tag-outline">考点 · ${esc(q.tag)}</span>
          ${answered.removedFromBook ? '<p class="explain-note">已移出，继续保持</p>' : ''}
        </section>`
      : '';

    let mainBtn;
    if (!answered && isMulti) {
      mainBtn = `<button type="button" class="btn btn-primary" data-action="confirm"${pending.length ? '' : ' disabled'}>确认</button>`;
    } else if (!answered) {
      mainBtn = '<button type="button" class="btn btn-primary" disabled>请选择</button>';
    } else if (step >= total) {
      mainBtn = '<button type="button" class="btn btn-primary" data-action="finish">交卷</button>';
    } else {
      mainBtn = '<button type="button" class="btn btn-primary" data-action="next">下一题</button>';
    }

    const grid = p.ids.map((id, index) => {
      const answer = p.answers[id];
      let cls = 'sheet-cell';
      if (answer) cls += answer.correct ? ' is-correct' : ' is-wrong';
      if (index === p.index) cls += ' is-current';
      return `<button type="button" class="${cls}" data-action="jump" data-index="${index}">${index + 1}</button>`;
    }).join('');

    const sheet = sheetOpen
      ? `<div class="mask" data-action="sheet-close"></div>
        <section class="sheet" role="dialog" aria-label="答题卡">
          <div class="sheet-head">
            <h2>答题卡</h2>
            <button type="button" class="sheet-close" data-action="sheet-close">关闭</button>
          </div>
          <div class="sheet-grid">${grid}</div>
          <div class="sheet-legend">
            <span><i class="dot correct"></i>答对</span>
            <span><i class="dot wrong"></i>答错</span>
            <span><i class="dot"></i>未答</span>
            <span><i class="dot now"></i>当前</span>
          </div>
        </section>`
      : '';

    return `<div class="quiz">
      <header class="quiz-top">
        <button type="button" class="icon-btn" data-action="exit" aria-label="退出答题">←</button>
        <div class="quiz-info">
          <div class="quiz-line">
            <span>第 ${step} 步 / 共 ${total} 步</span>
            <span>${esc(q.subject)} · ${isMulti ? '多选' : '单选'}</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
            <i style="width:${pct}%"></i>
          </div>
        </div>
      </header>

      <main class="quiz-body">
        <div class="q-tags">
          <span class="tag ${isMulti ? 'tag-multi' : 'tag-single'}">${isMulti ? '多选题' : '单选题'}</span>
          <span class="tag tag-subject">${esc(q.subject)}</span>
        </div>
        <h1 class="stem">${esc(q.stem)}</h1>
        <p class="quiz-hint">${isMulti ? '选出所有正确选项，然后点击「确认」' : '选择后立即判定'}</p>
        <div class="options">${options}</div>
        ${explain}
      </main>

      <footer class="quiz-foot">
        <button type="button" class="btn btn-ghost" data-action="prev"${p.index === 0 ? ' disabled' : ''}>上一题</button>
        <button type="button" class="btn btn-ghost" data-action="sheet">答题卡</button>
        ${mainBtn}
      </footer>
      ${sheet}
    </div>`;
  }

  function renderResult() {
    const r = data.lastResult;
    if (!r) return '';
    const total = r.total || r.ids.length;
    const correct = r.correct || 0;
    const wrongCount = Math.max(0, total - correct);
    const score = total ? Math.round((correct / total) * 100) : 0;
    const rate = total ? Math.round((correct / total) * 100) : 0;

    const wrongItems = r.ids
      .map((id) => QUESTION_MAP.get(id))
      .filter(Boolean)
      .filter((q) => {
        const answer = r.answers[q.id];
        return !answer || !answer.correct;
      });

    const list = wrongItems.map((q) => {
      const answer = r.answers[q.id];
      const mine = answer && answer.selected && answer.selected.length ? answer.selected.join('、') : '未作答';
      return `<article class="wrong-item">
        <p class="wrong-stem">${esc(q.stem)}</p>
        <div class="wrong-meta">
          <span>你的答案 ${esc(mine)}</span>
          <span>正确答案 <b>${answerKeys(q).join('、')}</b></span>
          <span>考点 ${esc(q.tag)}</span>
        </div>
      </article>`;
    }).join('');

    return `<div class="result">
      <p class="result-eyebrow">${esc(r.title || '本组完成')} · 已完成</p>
      <div class="score"><strong>${score}</strong><span>分</span></div>
      <p class="result-sub">答对 ${correct} 题 · 正确率 ${rate}% · 用时 ${formatDuration(r.elapsedMs)}</p>

      <div class="stat-grid">
        <div class="stat"><b>${correct}</b><small>答对</small></div>
        <div class="stat"><b>${wrongCount}</b><small>答错</small></div>
        <div class="stat"><b>${total}</b><small>本组题数</small></div>
      </div>

      <section class="wrong-block">
        <h2>错题清单</h2>
        ${list || '<p class="perfect">本组全部答对，没有错题。</p>'}
      </section>

      <div class="result-actions">
        <button type="button" class="btn btn-primary btn-lg" data-action="wrongbook-group"${wrongItems.length ? '' : ' disabled'}>查看错题</button>
        <button type="button" class="btn btn-ghost btn-lg" data-action="again">再来一组</button>
        <button type="button" class="btn btn-ghost btn-lg" data-action="home">回首页</button>
      </div>
    </div>`;
  }

  function shortenStem(text, len) {
    const value = String(text || '');
    return value.length > len ? `${value.slice(0, len)}…` : value;
  }

  function toggleWrongDetail(id) {
    if (expandedWrong.has(id)) expandedWrong.delete(id);
    else expandedWrong.add(id);
    render(true);
  }

  function removeWrongRecord(id) {
    data.wrongBook = data.wrongBook.filter((record) => record.id !== id);
    expandedWrong.delete(id);
    persist();
    render(true);
    toast('已移除');
  }

  function clearWrongBook() {
    data.wrongBook = [];
    expandedWrong = new Set();
    clearConfirmOpen = false;
    persist();
    render(true);
    toast('错题本已清空');
  }

  function retryFilteredWrong() {
    const records = sortedWrongRecords().filter((record) => {
      if (wrongFilter.scopeIds && !wrongFilter.scopeIds.has(record.id)) return false;
      const q = QUESTION_MAP.get(record.id);
      if (!q) return false;
      if (wrongFilter.subject !== 'all' && q.subject !== wrongFilter.subject) return false;
      if (wrongFilter.tag !== 'all' && q.tag !== wrongFilter.tag) return false;
      return true;
    });
    if (!records.length) return toast('当前没有可重刷的错题');
    startWrongRound(records.map((record) => record.id));
  }

  function renderWrongBook() {
    const all = sortedWrongRecords();
    const scope = wrongFilter.scopeIds;
    const scoped = all.filter((record) => !scope || scope.has(record.id));

    const subjectCounts = {};
    scoped.forEach((record) => {
      const q = QUESTION_MAP.get(record.id);
      if (q) subjectCounts[q.subject] = (subjectCounts[q.subject] || 0) + 1;
    });
    if (wrongFilter.subject !== 'all' && !subjectCounts[wrongFilter.subject]) {
      wrongFilter.subject = 'all';
      wrongFilter.tag = 'all';
    }

    const tagSet = new Set();
    scoped.forEach((record) => {
      const q = QUESTION_MAP.get(record.id);
      if (!q) return;
      if (wrongFilter.subject !== 'all' && q.subject !== wrongFilter.subject) return;
      tagSet.add(q.tag);
    });
    const tags = Array.from(tagSet);
    if (wrongFilter.tag !== 'all' && !tags.includes(wrongFilter.tag)) {
      wrongFilter.tag = 'all';
    }

    const filtered = scoped.filter((record) => {
      const q = QUESTION_MAP.get(record.id);
      if (!q) return false;
      if (wrongFilter.subject !== 'all' && q.subject !== wrongFilter.subject) return false;
      if (wrongFilter.tag !== 'all' && q.tag !== wrongFilter.tag) return false;
      return true;
    });

    const distribution = SUBJECTS
      .filter((subject) => subjectCounts[subject.name])
      .map((subject) => `${subject.name} ${subjectCounts[subject.name]}`)
      .join(' · ');

    const back = `<header class="wb-top">
      <button type="button" class="icon-btn" data-action="wrongbook-back" aria-label="返回">←</button>
      <div class="wb-title">
        <h1>错题本</h1>
        <p>${scope ? `本组错题 · ${scoped.length} 题` : `共 ${all.length} 题 · 答错自动收录`}</p>
      </div>
    </header>`;

    if (!all.length) {
      return `<div class="wrongbook">
        ${back}
        <main class="wb-body">
          <section class="wb-empty">
            <span class="wb-empty-mark">空</span>
            <h2>错题本还是空的</h2>
            <p>先做一组「今日十题」，答错的题会自动收进这里。</p>
            <button type="button" class="btn btn-primary btn-lg" data-action="daily">去做今日十题</button>
          </section>
        </main>
      </div>`;
    }

    const subjectChips = [
      `<button type="button" class="filter-chip${wrongFilter.subject === 'all' ? ' is-active' : ''}" data-action="wrongbook-subject" data-value="all">全部</button>`
    ].concat(
      SUBJECTS.filter((subject) => subjectCounts[subject.name]).map((subject) => (
        `<button type="button" class="filter-chip${wrongFilter.subject === subject.name ? ' is-active' : ''}" data-action="wrongbook-subject" data-value="${esc(subject.name)}">${esc(subject.name)}</button>`
      ))
    ).join('');

    const tagChips = [
      `<button type="button" class="filter-chip${wrongFilter.tag === 'all' ? ' is-active' : ''}" data-action="wrongbook-tag" data-value="all">全部</button>`
    ].concat(
      tags.map((tag) => (
        `<button type="button" class="filter-chip${wrongFilter.tag === tag ? ' is-active' : ''}" data-action="wrongbook-tag" data-value="${esc(tag)}">${esc(tag)}</button>`
      ))
    ).join('');

    const cards = filtered.map((record) => {
      const q = QUESTION_MAP.get(record.id);
      const keys = answerKeys(q);
      const mine = Array.isArray(record.lastAnswer) && record.lastAnswer.length ? record.lastAnswer.join('、') : '未作答';
      const open = expandedWrong.has(record.id);
      const options = q.options.map((option) => {
        let cls = 'wb-option';
        if (keys.includes(option.key)) cls += ' is-correct';
        else if (record.lastAnswer.includes(option.key)) cls += ' is-wrong';
        return `<div class="${cls}"><span class="opt-key">${esc(option.key)}</span><span class="wb-option-text">${esc(option.text)}</span></div>`;
      }).join('');
      return `<article class="wb-card${open ? ' is-open' : ''}" data-action="wrongbook-toggle" data-id="${esc(record.id)}">
        <div class="wb-card-top">
          <div class="wb-tags">
            <span class="tag tag-subject">${esc(q.subject)}</span>
            <span class="tag tag-outline">${esc(q.tag)}</span>
          </div>
          <button type="button" class="wb-remove" data-action="wrongbook-remove" data-id="${esc(record.id)}">移除</button>
        </div>
        <p class="wb-stem">${esc(shortenStem(q.stem, 30))}</p>
        <div class="wb-answer-line">
          <span>你的答案 ${esc(mine)}</span>
          <span>正确答案 <b>${keys.join('、')}</b></span>
          <span class="wb-times">错 ${record.wrongCount} 次</span>
        </div>
        ${open ? `<div class="wb-detail">
          <p class="wb-full-stem">${esc(q.stem)}</p>
          <div class="wb-options">${options}</div>
          <p class="wb-explain">${esc(q.explain)}</p>
        </div>` : ''}
      </article>`;
    }).join('');

    const retryTotal = filtered.length;
    const retryLabel = retryTotal === 0
      ? '重刷本页错题'
      : (retryTotal <= DAILY_TARGET ? `重刷 ${retryTotal} 题` : `重刷 ${DAILY_TARGET} 题（本页共 ${retryTotal} 题）`);

    let emptyBlock = '';
    if (!filtered.length) {
      const inScopeOnly = scoped.length === 0;
      emptyBlock = `<section class="wb-empty">
        <span class="wb-empty-mark">空</span>
        <h2>${inScopeOnly ? '这组错题已全部移出' : '这个筛选下没有错题'}</h2>
        <p>${inScopeOnly ? '本组没有剩余错题了。' : '换一个板块或考点看看。'}</p>
        ${scope
          ? '<button type="button" class="btn btn-ghost btn-lg" data-action="wrongbook-scope-clear">查看全部错题</button>'
          : '<button type="button" class="btn btn-ghost btn-lg" data-action="wrongbook-reset-filter">清除筛选</button>'}
      </section>`;
    }

    const clearDialog = clearConfirmOpen ? `<div class="dialog-mask" data-action="wrongbook-clear-cancel"></div>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="wb-clear-title">
        <h2 id="wb-clear-title">清空全部错题</h2>
        <p>清空后无法恢复，确定要清空全部 ${all.length} 条错题记录吗？</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-action="wrongbook-clear-cancel">取消</button>
          <button type="button" class="btn btn-ink" data-action="wrongbook-clear-confirm">清空全部</button>
        </div>
      </section>` : '';

    return `<div class="wrongbook">
      ${back}
      <main class="wb-body">
        <section class="card wb-summary">
          <div class="wb-summary-head">
            <span class="card-label">${scope ? '本组错题' : '错题总数'}</span>
            ${scope ? '<button type="button" class="wb-link" data-action="wrongbook-scope-clear">查看全部</button>' : ''}
          </div>
          <strong class="wb-total">${scoped.length}</strong>
          <p class="wb-dist">${distribution || '暂无错题'}</p>
        </section>

        <div class="wb-filters">
          <span class="wb-filter-label">板块</span>
          <div class="filter-scroll">${subjectChips}</div>
          <span class="wb-filter-label">考点</span>
          <div class="filter-scroll">${tagChips}</div>
        </div>

        <button type="button" class="btn btn-primary btn-lg wb-retry" data-action="wrongbook-retry"${filtered.length ? '' : ' disabled'}>${retryLabel}</button>

        ${filtered.length ? `<div class="wb-list">${cards}</div>` : emptyBlock}

        <div class="wb-foot">
          <button type="button" class="wb-clear" data-action="wrongbook-clear">清空全部</button>
        </div>
      </main>
      ${clearDialog}
    </div>`;
  }

  function startSession(mode, title, ids) {
    data.progress = {
      mode,
      title,
      ids: ids.slice(),
      index: 0,
      answers: {},
      pendingMap: {},
      startedAt: Date.now(),
      elapsedMs: 0,
      timerStartedAt: Date.now()
    };
    data.lastResult = null;
    sheetOpen = false;
    dialogOpen = false;
    persist();
    go('quiz');
  }

  function confirmReplace() {
    return !data.progress || window.confirm('当前有一组未完成的答题，开始新的练习会覆盖上次进度，是否继续？');
  }

  function startDaily() {
    if (!QUESTIONS.length) return toast('题库为空，请先检查题库文件');
    if (!confirmReplace()) return;
    const ids = shuffle(QUESTIONS.map((q) => q.id)).slice(0, DAILY_TARGET);
    startSession('daily', '今日十题', ids);
  }

  function startWrongRound(ids) {
    if (!ids.length) return false;
    if (!confirmReplace()) return false;
    startSession('wrong', '错题重刷', ids.slice(0, DAILY_TARGET));
    return true;
  }

  function sortedWrongRecords() {
    return validWrongRecords()
      .slice()
      .sort((a, b) => (Number(b.lastWrongAt) || 0) - (Number(a.lastWrongAt) || 0));
  }

  function upsertWrongRecord(q, picked) {
    const now = Date.now();
    const existing = getWrongRecord(q.id);
    const lastAnswer = picked.slice().sort();
    if (existing) {
      existing.wrongCount = (Number(existing.wrongCount) || 0) + 1;
      existing.lastWrongAt = now;
      existing.lastAnswer = lastAnswer;
      return;
    }
    data.wrongBook.push({
      id: q.id,
      wrongCount: 1,
      lastWrongAt: now,
      lastAnswer
    });
  }

  function startSubject(name) {
    const ids = QUESTIONS.filter((q) => q.subject === name).map((q) => q.id);
    if (!ids.length) return toast('该板块暂无题目');
    if (!confirmReplace()) return;
    startSession('subject', name, shuffle(ids));
  }

  function recordAnswer(q, selected) {
    const p = data.progress;
    if (!p) return;
    const picked = selected.slice().sort();
    const correct = sameSet(answerKeys(q), picked);
    p.answers[q.id] = { selected: picked, correct };
    if (p.pendingMap) delete p.pendingMap[q.id];
    ensureToday();
    data.today.count += 1;
    const key = todayKey();
    if (!data.checkins.includes(key)) data.checkins.push(key);
    const stat = data.stats[q.subject] || { answered: 0, correct: 0 };
    stat.answered += 1;
    if (correct) stat.correct += 1;
    data.stats[q.subject] = stat;
    if (correct) {
      if (getWrongRecord(q.id)) {
        data.wrongBook = data.wrongBook.filter((record) => record.id !== q.id);
        if (p.mode === 'wrong') p.answers[q.id].removedFromBook = true;
      }
    } else {
      upsertWrongRecord(q, picked);
    }
    saveProgress();
  }

  function scrollToExplain() {
    const el = app.querySelector('.explain');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top > window.innerHeight - 90 || rect.bottom < 0) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function pickOption(key) {
    const p = data.progress;
    const q = currentQuestion();
    if (!p || !q || p.answers[q.id]) return;
    if (q.type === 'multiple') {
      if (!p.pendingMap || typeof p.pendingMap !== 'object') p.pendingMap = {};
      const pending = Array.isArray(p.pendingMap[q.id]) ? p.pendingMap[q.id].slice() : [];
      const pos = pending.indexOf(key);
      if (pos >= 0) pending.splice(pos, 1);
      else pending.push(key);
      if (pending.length) p.pendingMap[q.id] = pending;
      else delete p.pendingMap[q.id];
      saveProgress();
      render(true);
      return;
    }
    recordAnswer(q, [key]);
    render(true);
    scrollToExplain();
  }

  function confirmMultiple() {
    const q = currentQuestion();
    const p = data.progress;
    if (!q || !p) return;
    const storedPending = p.pendingMap && p.pendingMap[q.id];
    const pending = Array.isArray(storedPending) ? storedPending : [];
    if (!pending.length) return toast('请至少选择一个选项');
    recordAnswer(q, pending);
    render(true);
    scrollToExplain();
  }

  function move(step) {
    const p = data.progress;
    if (!p) return;
    const nextIndex = p.index + step;
    if (nextIndex < 0) return;
    if (nextIndex >= p.ids.length) {
      if (step > 0) finishQuiz();
      return;
    }
    p.index = nextIndex;
    sheetOpen = false;
    saveProgress();
    render();
  }

  function jumpTo(index) {
    const p = data.progress;
    if (!p || !Number.isInteger(index)) return;
    p.index = Math.max(0, Math.min(p.ids.length - 1, index));
    sheetOpen = false;
    saveProgress();
    render();
  }

  function finishQuiz() {
    const p = data.progress;
    if (!p) return;
    touchTimer();
    const ids = p.ids.slice();
    const answers = JSON.parse(JSON.stringify(p.answers));
    let correct = 0;
    ids.forEach((id) => {
      if (answers[id] && answers[id].correct) correct += 1;
    });
    data.lastResult = {
      ids,
      answers,
      total: ids.length,
      correct,
      elapsedMs: Math.round(Number(p.elapsedMs) || 0),
      mode: p.mode,
      title: p.title,
      finishedAt: Date.now()
    };
    data.progress = null;
    sheetOpen = false;
    dialogOpen = false;
    persist();
    go('result');
  }

  function exitQuiz() {
    if (data.progress) saveProgress();
    sheetOpen = false;
    dialogOpen = false;
    go('home');
  }

  function openWrongBook(groupOnly) {
    const r = data.lastResult;
    let scopeIds = null;
    if (groupOnly && r) {
      const ids = r.ids.filter((id) => {
        const answer = r.answers[id];
        return (!answer || !answer.correct) && QUESTION_MAP.has(id);
      });
      if (!ids.length) return toast('本组全部答对，没有错题');
      scopeIds = new Set(ids);
    }
    wrongFilter = { subject: 'all', tag: 'all', scopeIds };
    expandedWrong = new Set();
    clearConfirmOpen = false;
    wrongBookReturn = groupOnly ? 'result' : 'home';
    go('wrongbook');
  }

  function restartCurrent() {
    const current = data.progress;
    const mode = current ? current.mode : 'daily';
    const title = current ? current.title : '';
    data.progress = null;
    dialogOpen = false;
    persist();
    if (mode === 'subject') startSubject(title);
    else if (mode === 'wrong') startWrongRound(sortedWrongRecords().map((record) => record.id).slice(0, DAILY_TARGET));
    else startDaily();
  }

  function handleAction(action, el) {
    switch (action) {
      case 'daily':
        startDaily();
        break;
      case 'wrongbook':
        openWrongBook(false);
        break;
      case 'wrongbook-group':
        openWrongBook(true);
        break;
      case 'wrongbook-back':
        go(wrongBookReturn);
        break;
      case 'wrongbook-subject':
        wrongFilter.subject = el.dataset.value;
        wrongFilter.tag = 'all';
        render(true);
        break;
      case 'wrongbook-tag':
        wrongFilter.tag = el.dataset.value;
        render(true);
        break;
      case 'wrongbook-scope-clear':
        wrongFilter = { subject: 'all', tag: 'all', scopeIds: null };
        render(true);
        break;
      case 'wrongbook-reset-filter':
        wrongFilter.subject = 'all';
        wrongFilter.tag = 'all';
        render(true);
        break;
      case 'wrongbook-toggle':
        toggleWrongDetail(el.dataset.id);
        break;
      case 'wrongbook-remove':
        removeWrongRecord(el.dataset.id);
        break;
      case 'wrongbook-retry':
        retryFilteredWrong();
        break;
      case 'wrongbook-clear':
        clearConfirmOpen = true;
        render(true);
        break;
      case 'wrongbook-clear-cancel':
        clearConfirmOpen = false;
        render(true);
        break;
      case 'wrongbook-clear-confirm':
        clearWrongBook();
        break;
      case 'subject':
        startSubject(el.dataset.subject);
        break;
      case 'resume':
        dialogOpen = false;
        go('quiz');
        break;
      case 'restart':
        dialogOpen = Boolean(data.progress);
        render(true);
        break;
      case 'restart-confirm':
        restartCurrent();
        break;
      case 'dialog-cancel':
        dialogOpen = false;
        render(true);
        break;
      case 'option':
        pickOption(el.dataset.key);
        break;
      case 'confirm':
        confirmMultiple();
        break;
      case 'prev':
        move(-1);
        break;
      case 'next':
        move(1);
        break;
      case 'finish':
        finishQuiz();
        break;
      case 'sheet':
        sheetOpen = true;
        render(true);
        break;
      case 'sheet-close':
        sheetOpen = false;
        render(true);
        break;
      case 'jump':
        jumpTo(Number(el.dataset.index));
        break;
      case 'exit':
        exitQuiz();
        break;
      case 'again':
        startDaily();
        break;
      case 'home':
        go('home');
        break;
      default:
        break;
    }
  }

  app.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    handleAction(el.dataset.action, el);
  });

  window.addEventListener('hashchange', () => {
    sheetOpen = false;
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (!data.progress) return;
    if (document.visibilityState === 'hidden') {
      touchTimer();
      data.progress.timerStartedAt = null;
      persist();
    } else if (!data.progress.timerStartedAt) {
      data.progress.timerStartedAt = Date.now();
    }
  });

  window.addEventListener('pagehide', () => {
    if (!data.progress) return;
    touchTimer();
    data.progress.timerStartedAt = null;
    persist();
  });

  if (!location.hash) history.replaceState(null, '', '#/home');
  render();
})();