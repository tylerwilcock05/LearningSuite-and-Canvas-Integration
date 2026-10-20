/**
 * Assignment Pulse - PWA Application Controller with Assignment Details Pop-up Modal
 */
(function () {
  'use strict';

  const PRESET_COLORS = ['#6366f1', '#10b981', '#ec4899', '#f59e0b', '#8b5cf6', '#3b82f6', '#06b6d4', '#ef4444'];

  // State Management
  const state = {
    userProfile: localStorage.getItem('pulse_user_profile') || 'Guest',
    canvasFeedUrl: localStorage.getItem('pulse_canvas_url') || '',
    lsCourses: JSON.parse(localStorage.getItem('pulse_ls_courses') || '[]'),
    assignments: JSON.parse(localStorage.getItem('pulse_assignments') || '[]'),
    completedHashes: new Set(JSON.parse(localStorage.getItem('pulse_completed_hashes') || '[]')),
    classOverrides: JSON.parse(localStorage.getItem('pulse_class_overrides') || '{}'),
    classColors: JSON.parse(localStorage.getItem('pulse_class_colors') || '{}'),
    showUndated: localStorage.getItem('pulse_show_undated') === 'true',
    layoutMode: localStorage.getItem('pulse_layout_mode') || 'rows',
    calendarSubMode: localStorage.getItem('pulse_cal_submode') || 'week',
    calendarAnchorDate: new Date(),
    selectedHashes: new Set(),
    activeView: 'active', // 'active' | 'completed'
    activeCourseFilter: 'ALL',
    searchQuery: '',
    theme: localStorage.getItem('pulse_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    lastActionUndoData: null
  };

  // Sanitize and deduplicate stored assignments on startup
  function cleanupLegacyAssignments() {
    const map = new Map();
    const updated = [];

    state.assignments.forEach(a => {
      // Flag items ending in _nodue or missing explicit due dates
      if ((a.id && a.id.endsWith('_nodue')) || a.hasNoDates || a.hasNoDueDate) {
        a.hasNoDueDate = true;
        a.hasNoDates = true;
      }

      const key = `${(a.source || '').toLowerCase()}_${(a.courseName || '').toLowerCase()}_${a.title.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, a);
        updated.push(a);
      } else {
        const existing = map.get(key);
        if (a.hasNoDueDate || (a.id && a.id.endsWith('_nodue'))) {
          existing.id = a.id;
          if (a.due) existing.due = a.due;
          existing.hasNoDueDate = true;
          existing.hasNoDates = true;
        }
      }
    });

    state.assignments = updated;
    saveState();
  }

  cleanupLegacyAssignments();

  let activeDetailsAssignmentId = null;

  // Deferred PWA Install Prompt
  let deferredInstallPrompt = null;

  // DOM Cache
  const elements = {};

  function initDomElements() {
    elements.themeToggleBtn = document.getElementById('themeToggleBtn');
    elements.profileBtn = document.getElementById('profileBtn');
    elements.profileLabel = document.getElementById('profileLabel');
    elements.installAppBtn = document.getElementById('installAppBtn');
    elements.addFeedsBtn = document.getElementById('addFeedsBtn');
    elements.fileDropZone = document.getElementById('fileDropZone');
    elements.fileInput = document.getElementById('fileInput');

    elements.searchInput = document.getElementById('searchInput');
    elements.viewActiveBtn = document.getElementById('viewActiveBtn');
    elements.viewCompletedBtn = document.getElementById('viewCompletedBtn');
    elements.coursePillsContainer = document.getElementById('coursePillsContainer');

    elements.assignmentsGrid = document.getElementById('assignmentsGrid');
    elements.emptyState = document.getElementById('emptyState');

    elements.floatingToolbar = document.getElementById('floatingToolbar');
    elements.selectedCountText = document.getElementById('selectedCountText');
    elements.markDoneBtn = document.getElementById('markDoneBtn');
    elements.selectAllBtn = document.getElementById('selectAllBtn');
    elements.clearSelectionBtn = document.getElementById('clearSelectionBtn');

    elements.toastContainer = document.getElementById('toastContainer');

    // Feeds Modal
    elements.feedsModal = document.getElementById('feedsModal');
    elements.closeFeedsModalBtn = document.getElementById('closeFeedsModalBtn');
    elements.saveFeedsBtn = document.getElementById('saveFeedsBtn');
    elements.canvasUrlInput = document.getElementById('canvasUrlInput');
    elements.addCanvasFeedBtn = document.getElementById('addCanvasFeedBtn');
    elements.continueGuestBtn = document.getElementById('continueGuestBtn');
    elements.profileNameInput = document.getElementById('profileNameInput');

    elements.addLsCourseName = document.getElementById('addLsCourseName');
    elements.addLsCourseUrl = document.getElementById('addLsCourseUrl');
    elements.addLsCourseBtn = document.getElementById('addLsCourseBtn');
    elements.modalUploadIcsBtn = document.getElementById('modalUploadIcsBtn');
    elements.modalIcsFileInput = document.getElementById('modalIcsFileInput');
    elements.canvasCoursesList = document.getElementById('canvasCoursesList');
    elements.lsCoursesList = document.getElementById('lsCoursesList');
    elements.uploadedCoursesList = document.getElementById('uploadedCoursesList');
    elements.toggleShowUndatedCheckbox = document.getElementById('toggleShowUndatedCheckbox');
    elements.layoutRowsBtn = document.getElementById('layoutRowsBtn');
    elements.layoutGridBtn = document.getElementById('layoutGridBtn');
    elements.layoutCalendarBtn = document.getElementById('layoutCalendarBtn');

    // Assignment Details Modal
    elements.assignmentDetailsModal = document.getElementById('assignmentDetailsModal');
    elements.closeDetailsModalBtn = document.getElementById('closeDetailsModalBtn');
    elements.modalCourseBadge = document.getElementById('modalCourseBadge');
    elements.modalAssignmentTitle = document.getElementById('modalAssignmentTitle');
    elements.modalDueBadge = document.getElementById('modalDueBadge');
    elements.modalSourceTag = document.getElementById('modalSourceTag');
    elements.modalAssignmentDescription = document.getElementById('modalAssignmentDescription');
    elements.modalExternalLinkBtn = document.getElementById('modalExternalLinkBtn');
    elements.modalToggleDoneBtn = document.getElementById('modalToggleDoneBtn');
    elements.syncStatusIndicator = document.getElementById('syncStatusIndicator');

    // Export Modal
    elements.exportBtn = document.getElementById('exportBtn');
    elements.exportModal = document.getElementById('exportModal');
    elements.closeExportModalBtn = document.getElementById('closeExportModalBtn');
    elements.exportOptUncompleted = document.getElementById('exportOptUncompleted');
    elements.exportOptAll = document.getElementById('exportOptAll');
    elements.exportSummaryLine = document.getElementById('exportSummaryLine');
    elements.confirmExportBtn = document.getElementById('confirmExportBtn');
  }

  // --- Helper: Robust Feed Fetcher ---
  async function fetchIcalFeed(inputStr) {
    if (!inputStr) throw new Error('No input provided.');
    const trimmed = inputStr.trim();

    if (trimmed.includes('BEGIN:VCALENDAR') || trimmed.includes('BEGIN:VEVENT')) {
      return trimmed;
    }

    let lastError = null;

    // Attempt 1: Local CORS Proxy (http://localhost:3000/fetch?url=...)
    try {
      const localProxyUrl = 'http://localhost:3000/fetch?url=' + encodeURIComponent(trimmed);
      const resp = await fetch(localProxyUrl);
      const text = await resp.text();
      if (resp.ok && (text.includes('BEGIN:VCALENDAR') || text.includes('BEGIN:VEVENT'))) {
        return text;
      } else if (!resp.ok) {
        lastError = `Proxy HTTP ${resp.status}: ${text.slice(0, 80)}`;
      }
    } catch (e) {
      console.log('Local proxy not reachable, trying direct/public proxies...', e);
      lastError = e.message;
    }

    // Attempt 2: Direct fetch
    try {
      const resp = await fetch(trimmed);
      const text = await resp.text();
      if (resp.ok && (text.includes('BEGIN:VCALENDAR') || text.includes('BEGIN:VEVENT'))) {
        return text;
      }
    } catch (e) {
      console.log('Direct fetch blocked by CORS, trying public CORS proxies...');
    }

    // Attempt 3: CORS Proxy (corsproxy.io)
    try {
      const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(trimmed);
      const resp = await fetch(proxyUrl);
      const text = await resp.text();
      if (resp.ok && (text.includes('BEGIN:VCALENDAR') || text.includes('BEGIN:VEVENT'))) {
        return text;
      }
    } catch (e) {
      console.log('corsproxy.io failed, trying allorigins...');
    }

    // Attempt 4: CORS Proxy (allorigins.win)
    try {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(trimmed);
      const resp = await fetch(proxyUrl);
      const text = await resp.text();
      if (resp.ok && (text.includes('BEGIN:VCALENDAR') || text.includes('BEGIN:VEVENT'))) {
        return text;
      }
    } catch (e) {
      console.log('allorigins failed.');
    }

    throw new Error(`Unable to fetch URL (${lastError || 'CORS blocked'}). Verify your URL or drop your exported .ics file into the top upload zone!`);
  }

  // Helper: Auto-assign course color
  function getCourseColor(rawCourseName) {
    if (state.classColors[rawCourseName]) return state.classColors[rawCourseName];
    let hash = 0;
    for (let i = 0; i < rawCourseName.length; i++) hash = rawCourseName.charCodeAt(i) + ((hash << 5) - hash);
    const color = PRESET_COLORS[Math.abs(hash) % PRESET_COLORS.length];
    state.classColors[rawCourseName] = color;
    return color;
  }

  // --- Theme Management ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pulse_theme', theme);
    if (elements.themeToggleBtn) {
      elements.themeToggleBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
      elements.themeToggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    }
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // --- Local Persistence ---
  function saveState() {
    localStorage.setItem('pulse_user_profile', state.userProfile);
    localStorage.setItem('pulse_canvas_url', state.canvasFeedUrl);
    localStorage.setItem('pulse_ls_courses', JSON.stringify(state.lsCourses));
    localStorage.setItem('pulse_assignments', JSON.stringify(state.assignments));
    localStorage.setItem('pulse_completed_hashes', JSON.stringify(Array.from(state.completedHashes)));
    localStorage.setItem('pulse_class_overrides', JSON.stringify(state.classOverrides));
    localStorage.setItem('pulse_class_colors', JSON.stringify(state.classColors));
  }

  // --- Helper: Format Due Dates ---
  // --- Helper: Format Due Dates ---
  function formatDueDate(isoString, hasNoDueDate = false) {
    if (!isoString && !hasNoDueDate) return { badgeText: 'No Due Date', badgeClass: 'due-future', group: 'Later' };

    const due = isoString ? new Date(isoString) : null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (hasNoDueDate) {
      if (!due || isNaN(due.getTime())) {
        return { badgeText: 'No Due Date', badgeClass: 'due-future', group: 'Later' };
      }

      const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const shortDateStr = due.toLocaleDateString([], { month: 'short', day: 'numeric' });

      let group = 'Later';
      if (dueDay < today) {
        group = 'Late';
      } else if (dueDay.getTime() === today.getTime()) {
        group = 'Due Today';
      } else if (dueDay.getTime() === tomorrow.getTime()) {
        group = 'Due Tomorrow';
      } else {
        const diffDays = Math.ceil((dueDay - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) {
          group = 'This Week';
        } else {
          group = 'Later';
        }
      }

      return {
        badgeText: `No Due Date (${shortDateStr})`,
        badgeClass: 'due-future',
        group
      };
    }

    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    const timeStr = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dayName = due.toLocaleDateString([], { weekday: 'long' });
    const shortDateStr = due.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const fullDateWithDay = due.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

    let group = 'Later';
    let badgeClass = 'due-future';
    let badgeText = `${fullDateWithDay} at ${timeStr}`;

    if (dueDay < today) {
      group = 'Late';
      badgeClass = 'due-late';
      badgeText = `Overdue (${fullDateWithDay} at ${timeStr})`;
    } else if (dueDay.getTime() === today.getTime()) {
      group = 'Due Today';
      badgeClass = 'due-today';
      badgeText = `Today (${dayName}) at ${timeStr}`;
    } else if (dueDay.getTime() === tomorrow.getTime()) {
      group = 'Due Tomorrow';
      badgeClass = 'due-tomorrow';
      badgeText = `Tomorrow (${dayName}) at ${timeStr}`;
    } else {
      const diffDays = Math.ceil((dueDay - today) / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) {
        group = 'This Week';
        badgeText = `${dayName}, ${shortDateStr} at ${timeStr}`;
      } else {
        group = 'Later';
        badgeText = `${fullDateWithDay} at ${timeStr}`;
      }
    }

    return { badgeText, badgeClass, group };
  }

  function getDisplayCourseName(rawCourseName) {
    return state.classOverrides[rawCourseName] || rawCourseName;
  }

  // --- Render Course Filter Pills ---
  function renderCoursePills() {
    if (!elements.coursePillsContainer) return;

    const courseSet = new Set();
    state.assignments.forEach(a => {
      if (a.courseName) courseSet.add(a.courseName);
    });

    const courses = Array.from(courseSet).sort();

    let html = `<button type="button" class="course-pill ${state.activeCourseFilter === 'ALL' ? 'active' : ''}" data-course="ALL">All Courses (${state.assignments.length})</button>`;

    courses.forEach(c => {
      const displayName = getDisplayCourseName(c);
      const isActive = state.activeCourseFilter === c;
      const count = state.assignments.filter(a => a.courseName === c).length;
      const color = getCourseColor(c);

      const customStyle = isActive
        ? `style="background: ${color}25; border-color: ${color}; color: ${color}; font-weight: 700;"`
        : `style="border-color: ${color}66; color: var(--text-secondary);"`;

      html += `<button type="button" class="course-pill ${isActive ? 'active' : ''}" data-course="${escapeHtml(c)}" ${customStyle}>
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>
        ${escapeHtml(displayName)} (${count})
      </button>`;
    });

    elements.coursePillsContainer.innerHTML = html;

    // Attach listeners
    elements.coursePillsContainer.querySelectorAll('.course-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeCourseFilter = btn.dataset.course;
        renderCoursePills();
        renderAssignments();
      });
    });
  }

  // --- Render Assignments Grid ---
  function renderAssignments() {
    if (!elements.assignmentsGrid) return;

    // Filter by Active vs Completed view
    let filtered = state.assignments.filter(a => {
      const isCompleted = state.completedHashes.has(a.id);
      return state.activeView === 'completed' ? isCompleted : !isCompleted;
    });

    // Filter out Learning Suite assignments with no due date unless setting is enabled
    if (!state.showUndated) {
      filtered = filtered.filter(a => {
        if (a.source === 'Canvas') return true;
        return !a.hasNoDueDate && !a.hasNoDates && a.due !== null;
      });
    }

    // Filter by Course
    if (state.activeCourseFilter !== 'ALL') {
      filtered = filtered.filter(a => a.courseName === state.activeCourseFilter);
    }

    // Filter by Search Query
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.courseName && a.courseName.toLowerCase().includes(q)) ||
        (a.description && a.description.toLowerCase().includes(q))
      );
    }

    if (state.layoutMode === 'calendar') {
      renderCalendarView(filtered);
      return;
    }

    if (filtered.length === 0) {
      elements.assignmentsGrid.innerHTML = '';
      elements.emptyState.style.display = 'block';
      const isSearch = !!state.searchQuery.trim();
      elements.emptyState.querySelector('.empty-text').textContent = isSearch
        ? 'No matching assignments found.'
        : (state.activeView === 'completed' ? 'No completed assignments yet.' : 'No active assignments! Add a course feed above or drop an .ics file.');
      return;
    }

    elements.emptyState.style.display = 'none';

    // Group items by due date urgency
    const groups = {
      'Late': [],
      'Due Today': [],
      'Due Tomorrow': [],
      'This Week': [],
      'Later': []
    };

    // Sort items by due date
    filtered.sort((a, b) => new Date(a.due) - new Date(b.due));

    filtered.forEach(a => {
      const { group } = formatDueDate(a.due, a.hasNoDueDate);
      if (!groups[group]) groups[group] = [];
      groups[group].push(a);
    });

    let html = '';

    const groupKeys = ['Late', 'Due Today', 'Due Tomorrow', 'This Week', 'Later'];
    const groupTitles = {
      'Late': '⚠️ Overdue Assignments',
      'Due Today': '📅 Due Today',
      'Due Tomorrow': '⏳ Due Tomorrow',
      'This Week': '🗓️ Due This Week',
      'Later': '📌 Upcoming Later'
    };
    const groupClasses = {
      'Late': 'section-late',
      'Due Today': 'section-today',
      'Due Tomorrow': 'section-tomorrow',
      'This Week': 'section-future',
      'Later': 'section-future'
    };

    groupKeys.forEach(key => {
      const list = groups[key];
      if (!list || list.length === 0) return;

      const gridClass = state.layoutMode === 'grid' ? 'assignments-grid layout-grid' : 'assignments-grid';

      html += `<div class="date-group">
        <h3 class="date-section-title ${groupClasses[key]}">${groupTitles[key]} (${list.length})</h3>
        <div class="${gridClass}">`;

      list.forEach(item => {
        const isSelected = state.selectedHashes.has(item.id);
        const dueInfo = formatDueDate(item.due, item.hasNoDueDate);
        const displayCourse = getDisplayCourseName(item.courseName);
        const courseColor = getCourseColor(item.courseName);

        const badgeStyle = `style="background: ${courseColor}20; color: ${courseColor}; border: 1px solid ${courseColor}40;"`;
        const cardStyle = `style="border-left: 4px solid ${courseColor};"`;

        html += `
          <div class="assignment-card ${isSelected ? 'selected' : ''}" ${cardStyle} data-id="${escapeHtml(item.id)}">
            <div class="card-left-content">
              <div class="check-circle" title="Select assignment">${isSelected ? '✓' : ''}</div>
              <div class="card-title-group">
                <div class="card-meta-line">
                  <span class="course-badge" ${badgeStyle} title="Double click to rename course" data-raw-course="${escapeHtml(item.courseName)}">${escapeHtml(displayCourse)}</span>
                  <span class="source-tag">${escapeHtml(item.source)}</span>
                </div>
                <h4 class="assignment-title">${escapeHtml(item.title)}</h4>
              </div>
            </div>
            <div class="card-right-content">
              <span class="due-badge ${dueInfo.badgeClass}">${escapeHtml(dueInfo.badgeText)}</span>
              ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="link-btn" onclick="event.stopPropagation();">Open ${escapeHtml(item.source)} ↗</a>` : ''}
              <span class="card-arrow" title="View details">›</span>
            </div>
          </div>
        `;

      });

      html += `</div></div>`;
    });

    elements.assignmentsGrid.innerHTML = html;

    // Attach Gesture Listeners to Cards
    attachCardGestureListeners();
    updateFloatingToolbar();
  }

  // --- Render Calendar View (3-Day & 7-Day Schedule) ---
  function getWeekDateRange(anchor) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const day = d.getDay();
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMon);

    const range = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday);
      dayDate.setDate(monday.getDate() + i);
      range.push(dayDate);
    }
    return range;
  }

  function get3DayDateRange(anchor) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const range = [];
    for (let i = 0; i < 3; i++) {
      const dayDate = new Date(d);
      dayDate.setDate(d.getDate() + i);
      range.push(dayDate);
    }
    return range;
  }

  function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  }

  function renderCalendarView(filtered) {
    if (!elements.assignmentsGrid) return;
    elements.emptyState.style.display = 'none';

    const is3Day = state.calendarSubMode === '3day';
    const range = is3Day
      ? get3DayDateRange(state.calendarAnchorDate)
      : getWeekDateRange(state.calendarAnchorDate);

    const startDay = range[0];
    const endDay = range[range.length - 1];
    const rangeLabelStr = `${startDay.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${endDay.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let html = `
      <div class="calendar-view-container">
        <div class="calendar-header-bar">
          <div class="calendar-nav-group">
            <button type="button" id="calPrevBtn" class="btn-secondary cal-nav-btn">‹ Prev</button>
            <button type="button" id="calTodayBtn" class="btn-secondary cal-nav-btn">Today</button>
            <button type="button" id="calNextBtn" class="btn-secondary cal-nav-btn">Next ›</button>
            <span class="cal-range-label">${escapeHtml(rangeLabelStr)}</span>
          </div>
          <div class="view-segmented-control">
            <button type="button" id="cal3DayBtn" class="segment-btn ${is3Day ? 'active' : ''}">3 Days</button>
            <button type="button" id="calWeekBtn" class="segment-btn ${!is3Day ? 'active' : ''}">7 Days (Week)</button>
          </div>
        </div>
        <div class="calendar-scroll-wrapper">
          <div class="calendar-schedule-grid ${is3Day ? 'mode-3day' : 'mode-week'}">
    `;

    range.forEach(dayDate => {
      const isToday = isSameDay(dayDate, todayDate);
      const dayName = dayDate.toLocaleDateString([], { weekday: 'short' });
      const dayNum = dayDate.getDate();

      const dayAssignments = filtered.filter(a => {
        if (!a.due) return false;
        return isSameDay(new Date(a.due), dayDate);
      });

      dayAssignments.sort((a, b) => new Date(a.due) - new Date(b.due));

      html += `
        <div class="cal-day-column ${isToday ? 'is-today' : ''}">
          <div class="cal-day-header">
            <span class="cal-day-name">${escapeHtml(dayName)}</span>
            <span class="cal-day-number ${isToday ? 'today-badge' : ''}">${dayNum}</span>
          </div>
          <div class="cal-day-body">
      `;

      if (dayAssignments.length === 0) {
        html += `<div class="cal-empty-day">No assignments due</div>`;
      } else {
        dayAssignments.forEach(item => {
          const isSelected = state.selectedHashes.has(item.id);
          const isDone = state.completedHashes.has(item.id);
          const displayCourse = getDisplayCourseName(item.courseName);
          const courseColor = getCourseColor(item.courseName);

          let timeStr = '';
          if (item.hasNoDueDate) {
            timeStr = 'No due date';
          } else if (item.due) {
            timeStr = new Date(item.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          }

          const badgeStyle = `style="background: ${courseColor}25; color: ${courseColor}; border: 1px solid ${courseColor}40;"`;
          const chipStyle = `style="border-left: 3px solid ${courseColor};"`;

          html += `
            <div class="assignment-card cal-chip ${isSelected ? 'selected' : ''} ${isDone ? 'completed' : ''}" ${chipStyle} data-id="${escapeHtml(item.id)}">
              <div class="check-circle" title="Select assignment">${isDone ? '✓' : (isSelected ? '✓' : '')}</div>
              <div class="cal-chip-content">
                <div class="cal-chip-meta">
                  <span class="course-badge" ${badgeStyle}>${escapeHtml(displayCourse)}</span>
                  <span class="cal-time-text">${escapeHtml(timeStr)}</span>
                </div>
                <div class="cal-chip-title">${escapeHtml(item.title)}</div>
              </div>
            </div>
          `;
        });
      }

      html += `</div></div>`;
    });

    html += `</div></div></div>`;


    elements.assignmentsGrid.innerHTML = html;

    // Attach Calendar Event Listeners
    const calPrevBtn = document.getElementById('calPrevBtn');
    const calNextBtn = document.getElementById('calNextBtn');
    const calTodayBtn = document.getElementById('calTodayBtn');
    const cal3DayBtn = document.getElementById('cal3DayBtn');
    const calWeekBtn = document.getElementById('calWeekBtn');

    if (calPrevBtn) {
      calPrevBtn.addEventListener('click', () => {
        const step = is3Day ? 3 : 7;
        state.calendarAnchorDate.setDate(state.calendarAnchorDate.getDate() - step);
        renderAssignments();
      });
    }

    if (calNextBtn) {
      calNextBtn.addEventListener('click', () => {
        const step = is3Day ? 3 : 7;
        state.calendarAnchorDate.setDate(state.calendarAnchorDate.getDate() + step);
        renderAssignments();
      });
    }

    if (calTodayBtn) {
      calTodayBtn.addEventListener('click', () => {
        state.calendarAnchorDate = new Date();
        renderAssignments();
      });
    }

    if (cal3DayBtn) {
      cal3DayBtn.addEventListener('click', () => {
        state.calendarSubMode = '3day';
        localStorage.setItem('pulse_cal_submode', '3day');
        renderAssignments();
      });
    }

    if (calWeekBtn) {
      calWeekBtn.addEventListener('click', () => {
        state.calendarSubMode = 'week';
        localStorage.setItem('pulse_cal_submode', 'week');
        renderAssignments();
      });
    }

    // Attach Card Gesture Listeners to Calendar Chips
    attachCardGestureListeners();
    updateFloatingToolbar();
  }

  // --- Modal Course Customizers Renderer ---
  function renderModalCourseLists() {
    if (!elements.canvasCoursesList || !elements.lsCoursesList) return;

    // 1. Render Canvas Courses
    const canvasCourseSet = new Set();
    state.assignments.filter(a => a.source === 'Canvas').forEach(a => canvasCourseSet.add(a.courseName));

    const canvasCourses = Array.from(canvasCourseSet).sort();

    if (canvasCourses.length === 0) {
      elements.canvasCoursesList.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No Canvas courses added yet. Paste your Canvas iCal feed URL above and click "➕ Add Canvas Feed".</p>';
    } else {
      let canvasHtml = '';
      canvasCourses.forEach(rawName => {
        const displayName = getDisplayCourseName(rawName);
        const color = getCourseColor(rawName);

        canvasHtml += `
          <div class="course-item-row">
            <input type="color" class="course-color-picker" data-course="${escapeHtml(rawName)}" value="${color}">
            <input type="text" class="course-rename-input" data-course="${escapeHtml(rawName)}" value="${escapeHtml(displayName)}" placeholder="Rename course...">
            <span class="source-tag">Canvas</span>
          </div>
        `;
      });
      elements.canvasCoursesList.innerHTML = canvasHtml;

      // Attach Listeners
      elements.canvasCoursesList.querySelectorAll('.course-color-picker').forEach(input => {
        input.addEventListener('input', (e) => {
          const rawName = e.target.dataset.course;
          state.classColors[rawName] = e.target.value;
          saveState();
          renderCoursePills();
          renderAssignments();
        });
      });

      elements.canvasCoursesList.querySelectorAll('.course-rename-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const rawName = e.target.dataset.course;
          state.classOverrides[rawName] = e.target.value.trim();
          saveState();
          renderCoursePills();
          renderAssignments();
        });
      });
    }

    // 2. Render Learning Suite Courses
    if (state.lsCourses.length === 0) {
      elements.lsCoursesList.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No Learning Suite courses added yet.</p>';
    } else {
      let lsHtml = '';
      state.lsCourses.forEach((c, idx) => {
        const displayName = getDisplayCourseName(c.name);
        const color = getCourseColor(c.name);

        lsHtml += `
          <div class="course-item-row">
            <input type="color" class="course-color-picker" data-ls-idx="${idx}" value="${color}">
            <input type="text" class="course-rename-input" data-ls-idx="${idx}" value="${escapeHtml(displayName)}" placeholder="Rename course...">
            <button type="button" class="btn-secondary delete-ls-item-btn" data-ls-idx="${idx}" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; color: var(--badge-late-text);">🗑️</button>
          </div>
        `;
      });
      elements.lsCoursesList.innerHTML = lsHtml;

      // Attach Listeners
      elements.lsCoursesList.querySelectorAll('.course-color-picker').forEach(input => {
        input.addEventListener('input', (e) => {
          const idx = +e.target.dataset.lsIdx;
          const course = state.lsCourses[idx];
          if (course) {
            course.color = e.target.value;
            state.classColors[course.name] = e.target.value;
            saveState();
            renderCoursePills();
            renderAssignments();
          }
        });
      });

      elements.lsCoursesList.querySelectorAll('.course-rename-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const idx = +e.target.dataset.lsIdx;
          const course = state.lsCourses[idx];
          if (course) {
            const newName = e.target.value.trim();
            state.classOverrides[course.name] = newName;
            saveState();
            renderCoursePills();
            renderAssignments();
          }
        });
      });

      elements.lsCoursesList.querySelectorAll('.delete-ls-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = +btn.dataset.lsIdx;
          const removed = state.lsCourses.splice(idx, 1)[0];
          if (removed) {
            state.assignments = state.assignments.filter(a => a.courseName !== removed.name);
            saveState();
            showToast(`Removed course ${removed.name}`);
            renderModalCourseLists();
            renderCoursePills();
            renderAssignments();
          }
        });
      });
    }

    // 3. Render Uploaded & Other Courses
    if (elements.uploadedCoursesList) {
      const canvasSet = new Set(canvasCourseSet);
      const lsSet = new Set(state.lsCourses.map(c => c.name));

      const uploadedCourseSet = new Set();
      state.assignments.forEach(a => {
        if (!canvasSet.has(a.courseName) && !lsSet.has(a.courseName)) {
          if (a.courseName) uploadedCourseSet.add(a.courseName);
        }
      });

      const uploadedCourses = Array.from(uploadedCourseSet).sort();

      if (uploadedCourses.length === 0) {
        elements.uploadedCoursesList.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No uploaded .ics courses yet. Click "📁 Choose & Upload .ics File" above to add one.</p>';
      } else {
        let uploadedHtml = '';
        uploadedCourses.forEach(rawName => {
          const displayName = getDisplayCourseName(rawName);
          const color = getCourseColor(rawName);

          uploadedHtml += `
            <div class="course-item-row">
              <input type="color" class="course-color-picker" data-course="${escapeHtml(rawName)}" value="${color}">
              <input type="text" class="course-rename-input" data-course="${escapeHtml(rawName)}" value="${escapeHtml(displayName)}" placeholder="Rename course...">
              <button type="button" class="btn-secondary delete-uploaded-course-btn" data-course="${escapeHtml(rawName)}" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; color: var(--badge-late-text);" title="Remove course and assignments">🗑️</button>
            </div>
          `;
        });
        elements.uploadedCoursesList.innerHTML = uploadedHtml;

        // Color picker listeners
        elements.uploadedCoursesList.querySelectorAll('.course-color-picker').forEach(input => {
          input.addEventListener('input', (e) => {
            const rawName = e.target.dataset.course;
            state.classColors[rawName] = e.target.value;
            saveState();
            renderCoursePills();
            renderAssignments();
          });
        });

        // Rename input listeners
        elements.uploadedCoursesList.querySelectorAll('.course-rename-input').forEach(input => {
          input.addEventListener('input', (e) => {
            const rawName = e.target.dataset.course;
            state.classOverrides[rawName] = e.target.value.trim();
            saveState();
            renderCoursePills();
            renderAssignments();
          });
        });

        // Delete course listeners
        elements.uploadedCoursesList.querySelectorAll('.delete-uploaded-course-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const rawName = btn.dataset.course;
            state.assignments = state.assignments.filter(a => a.courseName !== rawName);
            delete state.classColors[rawName];
            delete state.classOverrides[rawName];
            saveState();
            showToast(`Removed uploaded course ${rawName}`);
            renderModalCourseLists();
            renderCoursePills();
            renderAssignments();
          });
        });
      }
    }
  }

  function renderFormattedDescription(rawText) {
    if (!rawText || !rawText.trim()) {
      return '<span style="color: var(--text-muted); font-style: italic;">No description provided for this assignment.</span>';
    }

    let text = String(rawText);

    // 1. Convert HTML line break & block closure tags into newlines if present
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n');

    // 2. Decode HTML entities if text is entity-encoded (e.g. &lt;a href=...&gt; or &amp;)
    if (text.includes('&lt;') || text.includes('&gt;')) {
      const txt = document.createElement('textarea');
      txt.innerHTML = text;
      text = txt.value;
    }

    // 3. Pre-process: Fix concatenated URLs/links where newlines were stripped by iCal line folding
    // E.g. "questionshttps://..." -> "questions\n\nhttps://..."
    text = text.replace(/([a-zA-Z0-9.,!?:]+)(https?:\/\/)/g, '$1\n\n$2');
    text = text.replace(/([a-zA-Z0-9.,!?:]+)(www\.[a-zA-Z0-9])/g, '$1\n\n$2');
    text = text.replace(/([a-zA-Z0-9.,!?:]+)(\[[^\]]+\]\s*\()/g, '$1\n\n$2');

    const tokens = [];

    // 4. Extract existing HTML <a> links if present
    text = text.replace(/<a\s+[^>]*href=["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>(.*?)<\/a>/gi, (match, url, linkText) => {
      const cleanUrl = url.trim().replace(/[\.\,\;\!\?\)\=\"\']+$/, '');
      const rawLabel = linkText.replace(/<[^>]+>/g, '').trim();
      const cleanLabel = (rawLabel || cleanUrl).replace(/\s*↗$/, '') + ' ↗';
      const idx = tokens.length;
      tokens.push(`<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="desc-link">${cleanLabel}</a>`);
      return `___DESCLINK_TOKEN_${idx}___`;
    });

    // 5. Parse Markdown Links:
    // Matches [Link Text](http://...), [Link Text] (http://...), [Link Text] ( http://... ), [Link Text] ("http://...")
    text = text.replace(/\[([^\]]+)\]\s*\(\s*<?["']?(https?:\/\/[^\s\)\"\'>]+)["']?>?\s*\)/gi, (match, linkText, url) => {
      const cleanUrl = url.trim().replace(/[\.\,\;\!\?\)\=\"\']+$/, '');
      const cleanLabel = linkText.trim().replace(/\s*↗$/, '') + ' ↗';
      const idx = tokens.length;
      tokens.push(`<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="desc-link">${cleanLabel}</a>`);
      return `___DESCLINK_TOKEN_${idx}___`;
    });

    // 6. Parse Standalone unformatted URLs (that haven't been tokenized)
    text = text.replace(/(^|[\s\n\(\>])(https?:\/\/[^\s\)\<\"]+)/gi, (match, prefix, url) => {
      if (prefix.includes('___DESCLINK_TOKEN_')) return match;
      const cleanUrl = url.trim().replace(/[\.\,\;\!\?\)\=\"\']+$/, '');
      const idx = tokens.length;
      tokens.push(`<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="desc-link">${cleanUrl} ↗</a>`);
      return `${prefix}___DESCLINK_TOKEN_${idx}___`;
    });

    // 7. Safely escape any remaining raw HTML tags
    let safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 8. Restore link tokens
    tokens.forEach((htmlLink, idx) => {
      safe = safe.replace(`___DESCLINK_TOKEN_${idx}___`, htmlLink);
    });

    // 9. Preserve line breaks (collapse 3+ newlines into 2)
    safe = safe.replace(/\n{3,}/g, '\n\n');
    return safe.replace(/\r?\n/g, '<br>');
  }

  // --- Open Assignment Details Pop-Up Modal ---
  function openAssignmentDetails(id) {
    const item = state.assignments.find(a => a.id === id);
    if (!item) return;

    activeDetailsAssignmentId = id;

    const displayCourse = getDisplayCourseName(item.courseName);
    const courseColor = getCourseColor(item.courseName);
    const dueInfo = formatDueDate(item.due, item.hasNoDueDate);

    if (elements.modalCourseBadge) {
      elements.modalCourseBadge.textContent = displayCourse;
      elements.modalCourseBadge.style.background = `${courseColor}20`;
      elements.modalCourseBadge.style.color = courseColor;
      elements.modalCourseBadge.style.border = `1px solid ${courseColor}40`;
    }

    if (elements.modalAssignmentTitle) elements.modalAssignmentTitle.textContent = item.title;

    if (elements.modalDueBadge) {
      elements.modalDueBadge.textContent = dueInfo.badgeText;
      elements.modalDueBadge.className = `due-badge ${dueInfo.badgeClass}`;
    }

    if (elements.modalSourceTag) elements.modalSourceTag.textContent = item.source;

    if (elements.modalAssignmentDescription) {
      elements.modalAssignmentDescription.innerHTML = renderFormattedDescription(item.description);
    }

    if (elements.modalExternalLinkBtn) {
      if (item.url) {
        elements.modalExternalLinkBtn.style.display = 'inline-flex';
        elements.modalExternalLinkBtn.href = item.url;
        elements.modalExternalLinkBtn.textContent = `Open ${item.source} ↗`;
      } else {
        elements.modalExternalLinkBtn.style.display = 'none';
      }
    }

    if (elements.modalToggleDoneBtn) {
      const isDone = state.completedHashes.has(id);
      if (isDone) {
        elements.modalToggleDoneBtn.textContent = '📚 Mark Active';
        elements.modalToggleDoneBtn.style.background = 'linear-gradient(135deg, #4f46e5, #7c3aed)';
      } else {
        elements.modalToggleDoneBtn.textContent = 'Mark as Done';
        elements.modalToggleDoneBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      }
    }

    if (elements.assignmentDetailsModal) {
      elements.assignmentDetailsModal.classList.add('active');
    }
  }

  // --- Desktop & Mobile Gesture Engine ---
  function attachCardGestureListeners() {
    const cards = elements.assignmentsGrid.querySelectorAll('.assignment-card');

    cards.forEach(card => {
      const id = card.dataset.id;
      let touchTimer = null;
      let touchMoved = false;

      // Desktop & Touch Checkmark Circle Click Target -> Toggles Selection
      const checkCircle = card.querySelector('.check-circle');
      if (checkCircle) {
        checkCircle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleCardSelection(id);
        });
      }

      // Course Name Rename Handler (Double Click)
      const courseBadge = card.querySelector('.course-badge');
      if (courseBadge) {
        courseBadge.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const rawCourse = courseBadge.dataset.rawCourse;
          const currentDisplay = getDisplayCourseName(rawCourse);
          const newName = prompt(`Rename class "${currentDisplay}":`, currentDisplay);
          if (newName !== null && newName.trim()) {
            state.classOverrides[rawCourse] = newName.trim();
            saveState();
            renderCoursePills();
            renderAssignments();
            renderModalCourseLists();
          }
        });
      }

      // Card Body Click: If in Multi-Select Mode, toggle selection. Otherwise open Assignment Details Modal!
      card.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('.check-circle')) return;

        if (state.selectedHashes.size > 0) {
          toggleCardSelection(id);
        } else {
          openAssignmentDetails(id);
        }
      });

      // Mobile Touch Gesture: Press & Hold (Long-Press ~400ms) enters Multi-Select mode
      card.addEventListener('touchstart', (e) => {
        touchMoved = false;
        card.classList.add('long-press-active');
        touchTimer = setTimeout(() => {
          card.classList.remove('long-press-active');
          if (navigator.vibrate) navigator.vibrate(40);
          toggleCardSelection(id);
          document.body.classList.add('multi-select-mode');
        }, 400);
      }, { passive: true });

      card.addEventListener('touchmove', () => {
        touchMoved = true;
        card.classList.remove('long-press-active');
        if (touchTimer) clearTimeout(touchTimer);
      }, { passive: true });

      card.addEventListener('touchend', () => {
        card.classList.remove('long-press-active');
        if (touchTimer) clearTimeout(touchTimer);
      });

      card.addEventListener('touchcancel', () => {
        card.classList.remove('long-press-active');
        if (touchTimer) clearTimeout(touchTimer);
      });
    });
  }

  function toggleCardSelection(id) {
    if (state.selectedHashes.has(id)) {
      state.selectedHashes.delete(id);
    } else {
      state.selectedHashes.add(id);
    }

    const isSelected = state.selectedHashes.has(id);

    // Update target card DOM in-place to preserve hover & element identity
    const card = elements.assignmentsGrid.querySelector(`.assignment-card[data-id="${CSS.escape(id)}"]`);
    if (card) {
      card.classList.toggle('selected', isSelected);
      const checkCircle = card.querySelector('.check-circle');
      if (checkCircle) {
        checkCircle.textContent = isSelected ? '✓' : '';
      }
    }

    if (state.selectedHashes.size > 0) {
      document.body.classList.add('multi-select-mode');
    } else {
      document.body.classList.remove('multi-select-mode');
    }

    updateFloatingToolbar();
  }

  function updateFloatingToolbar() {
    const count = state.selectedHashes.size;
    if (count > 0) {
      elements.selectedCountText.textContent = `${count} selected`;
      elements.floatingToolbar.classList.add('active');
      elements.markDoneBtn.textContent = state.activeView === 'completed' ? '📚 Mark Active' : 'Mark as Done';
    } else {
      elements.floatingToolbar.classList.remove('active');
      document.body.classList.remove('multi-select-mode');
    }
  }

  // --- Bulk Actions & Toast ---
  function markSelectedAsDone() {
    if (state.selectedHashes.size === 0) return;

    const selectedIds = Array.from(state.selectedHashes);

    if (state.activeView === 'active') {
      selectedIds.forEach(id => state.completedHashes.add(id));
      showToast(`${selectedIds.length} assignment${selectedIds.length > 1 ? 's' : ''} marked as done.`, () => {
        selectedIds.forEach(id => state.completedHashes.delete(id));
        saveState();
        renderAssignments();
      });
    } else {
      selectedIds.forEach(id => state.completedHashes.delete(id));
      showToast(`${selectedIds.length} assignment${selectedIds.length > 1 ? 's' : ''} restored to active.`, () => {
        selectedIds.forEach(id => state.completedHashes.add(id));
        saveState();
        renderAssignments();
      });
    }

    state.selectedHashes.clear();
    saveState();
    renderAssignments();
  }

  function selectAllVisible() {
    let visible = state.assignments.filter(a => {
      const isCompleted = state.completedHashes.has(a.id);
      return state.activeView === 'completed' ? isCompleted : !isCompleted;
    });

    if (state.activeCourseFilter !== 'ALL') {
      visible = visible.filter(a => a.courseName === state.activeCourseFilter);
    }

    visible.forEach(a => state.selectedHashes.add(a.id));
    renderAssignments();
  }

  function clearSelection() {
    state.selectedHashes.clear();
    renderAssignments();
  }

  function showToast(message, undoCallback) {
    if (!elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span>${escapeHtml(message)}</span>
      ${undoCallback ? `<button type="button" class="toast-undo-btn">Undo</button>` : ''}
    `;

    if (undoCallback) {
      const undoBtn = toast.querySelector('.toast-undo-btn');
      undoBtn.addEventListener('click', () => {
        undoCallback();
        toast.remove();
      });
    }

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 5000);
  }

  // --- Ingestion: File Drop & URL Sync ---
  function handleFiles(files) {
    Array.from(files).forEach(file => {
      if (!file.name.endsWith('.ics')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const rawContent = e.target.result;
        const result = window.IcalParser.parseIcalContent(rawContent, file.name.replace(/\.ics$/i, ''));

        if (result && result.assignments.length > 0) {
          mergeNewAssignments(result.assignments);
          showToast(`Imported ${result.assignments.length} assignments from ${file.name}`);
        } else {
          showToast(`No valid assignments found in ${file.name}`);
        }
      };
      reader.readAsText(file);
    });
  }

  function mergeNewAssignments(newAssignments) {
    newAssignments.forEach(newItem => {
      const normTitle = newItem.title.toLowerCase().trim();
      const normCourse = (newItem.courseName || '').toLowerCase().trim();
      const normSource = (newItem.source || '').toLowerCase().trim();

      // Find if an assignment with same source, course, and title already exists
      const existingIdx = state.assignments.findIndex(a => {
        const aTitle = a.title.toLowerCase().trim();
        const aCourse = (a.courseName || '').toLowerCase().trim();
        const aSource = (a.source || '').toLowerCase().trim();
        return aSource === normSource && aCourse === normCourse && aTitle === normTitle;
      });

      if (existingIdx !== -1) {
        // Update existing assignment in-place with latest parsed due date & flags!
        const existing = state.assignments[existingIdx];
        existing.id = newItem.id;
        existing.due = newItem.due;
        existing.hasNoDueDate = newItem.hasNoDueDate;
        existing.hasNoDates = newItem.hasNoDates;
        existing.url = newItem.url;
        existing.description = newItem.description;
      } else {
        state.assignments.push(newItem);
      }
    });

    cleanupLegacyAssignments();
    saveState();
    renderCoursePills();
    renderAssignments();
    renderModalCourseLists();
  }

  const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  function showSyncStatus(message, isError = false) {
    const el = elements.syncStatusIndicator;
    if (!el) return;
    el.style.display = 'inline-flex';
    el.style.color = isError ? 'var(--badge-late-text)' : 'var(--text-muted)';
    el.textContent = message;
  }

  function hideSyncStatus(delayMs = 3000) {
    setTimeout(() => {
      if (elements.syncStatusIndicator) {
        elements.syncStatusIndicator.style.display = 'none';
        elements.syncStatusIndicator.textContent = '';
      }
    }, delayMs);
  }

  async function syncFeedUrls() {
    const canvasUrl = state.canvasFeedUrl.trim();
    const hasFeeds = canvasUrl || state.lsCourses.some(c => c.url);
    if (!hasFeeds) return;

    showSyncStatus('⟳ Syncing...');
    let newCount = 0;
    const prevCount = state.assignments.length;

    if (canvasUrl) {
      try {
        const text = await fetchIcalFeed(canvasUrl);
        const parsed = window.IcalParser.parseIcalContent(text, 'Canvas');
        mergeNewAssignments(parsed.assignments);
      } catch (err) {
        console.warn('Canvas sync:', err.message);
      }
    }

    for (const course of state.lsCourses) {
      if (!course.url) continue;
      try {
        const text = await fetchIcalFeed(course.url);
        const parsed = window.IcalParser.parseIcalContent(text, 'Learning Suite');
        parsed.assignments.forEach(a => {
          if (course.name) a.courseName = course.name;
        });
        mergeNewAssignments(parsed.assignments);
      } catch (err) {
        console.warn(`Learning Suite sync for ${course.name}:`, err.message);
      }
    }

    newCount = state.assignments.length - prevCount;
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (newCount > 0) {
      showSyncStatus(`✓ Synced · ${newCount} new (${now})`);
    } else {
      showSyncStatus(`✓ Synced at ${now}`);
    }
    hideSyncStatus(4000);
  }

  // Utility HTML Escape
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[c]);
  }

  // --- iCal Export Generator ---
  function generateIcalExport(assignments) {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const foldLine = (line) => {
      // RFC 5545: fold lines longer than 75 octets
      const bytes = new TextEncoder().encode(line);
      if (bytes.length <= 75) return line;
      let result = '';
      let pos = 0;
      let lineStart = 0;
      let lineLen = 0;
      while (pos < line.length) {
        const charBytes = new TextEncoder().encode(line[pos]).length;
        if (lineLen + charBytes > 75) {
          result += line.slice(lineStart, pos) + '\r\n ';
          lineStart = pos;
          lineLen = 1; // leading space
        }
        lineLen += charBytes;
        pos++;
      }
      result += line.slice(lineStart);
      return result;
    };

    const escapeIcal = (str) =>
      (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const toIcalDate = (isoStr) => {
      if (!isoStr) return null;
      return new Date(isoStr).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };

    let cal = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Assignment Pulse//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Assignment Pulse Export',
    ];

    assignments.forEach((item) => {
      const dueDate = toIcalDate(item.due);
      const uid = item.id + '@assignmentpulse';
      const summary = escapeIcal(item.title);
      const description = escapeIcal(
        [item.description, item.url ? 'Link: ' + item.url : ''].filter(Boolean).join('\n')
      );
      const courseName = escapeIcal(getDisplayCourseName(item.courseName));

      cal.push('BEGIN:VEVENT');
      cal.push(foldLine('UID:' + uid));
      cal.push('DTSTAMP:' + stamp);
      if (dueDate) {
        cal.push('DTSTART:' + dueDate);
        cal.push('DTEND:' + dueDate);
      }
      cal.push(foldLine('SUMMARY:' + summary));
      if (description) cal.push(foldLine('DESCRIPTION:' + description));
      if (item.url) cal.push(foldLine('URL:' + item.url));
      cal.push(foldLine('CATEGORIES:' + courseName));
      if (state.completedHashes.has(item.id)) {
        cal.push('STATUS:COMPLETED');
      }
      cal.push('END:VEVENT');
    });

    cal.push('END:VCALENDAR');
    return cal.join('\r\n');
  }

  function downloadIcalFile(icalContent, filename) {
    const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function updateExportSummary() {
    if (!elements.exportSummaryLine) return;
    const exportAll = elements.exportOptAll && elements.exportOptAll.checked;
    const total = state.assignments.length;
    const completed = state.completedHashes.size;
    const active = total - completed;
    elements.exportSummaryLine.textContent = exportAll
      ? `Will export ${total} assignment${total !== 1 ? 's' : ''} (${active} active, ${completed} completed)`
      : `Will export ${active} active assignment${active !== 1 ? 's' : ''}`;
  }

  // --- Initial Setup & Listeners ---
  document.addEventListener('DOMContentLoaded', () => {
    initDomElements();
    applyTheme(state.theme);

    // Profile Display
    elements.profileLabel.textContent = state.userProfile;

    // Theme Toggle Listener
    elements.themeToggleBtn.addEventListener('click', toggleTheme);

    // Details Modal Close & Action Listeners
    elements.closeDetailsModalBtn.addEventListener('click', () => {
      elements.assignmentDetailsModal.classList.remove('active');
    });

    elements.assignmentDetailsModal.addEventListener('click', (e) => {
      if (e.target === elements.assignmentDetailsModal) {
        elements.assignmentDetailsModal.classList.remove('active');
      }
    });

    elements.feedsModal.addEventListener('click', (e) => {
      if (e.target === elements.feedsModal) {
        elements.feedsModal.classList.remove('active');
      }
    });

    elements.modalToggleDoneBtn.addEventListener('click', () => {
      if (!activeDetailsAssignmentId) return;
      const id = activeDetailsAssignmentId;
      const isDone = state.completedHashes.has(id);
      if (isDone) {
        state.completedHashes.delete(id);
        showToast('Assignment restored to active.');
      } else {
        state.completedHashes.add(id);
        showToast('Assignment marked as done.');
      }
      saveState();
      elements.assignmentDetailsModal.classList.remove('active');
      renderAssignments();
    });

    // View Switching (Active vs Completed)
    elements.viewActiveBtn.addEventListener('click', () => {
      state.activeView = 'active';
      elements.viewActiveBtn.classList.add('active');
      elements.viewCompletedBtn.classList.remove('active');
      state.selectedHashes.clear();
      renderAssignments();
    });

    elements.viewCompletedBtn.addEventListener('click', () => {
      state.activeView = 'completed';
      elements.viewCompletedBtn.classList.add('active');
      elements.viewActiveBtn.classList.remove('active');
      state.selectedHashes.clear();
      renderAssignments();
    });

    // Layout Mode Switching (Rows vs Grid vs Calendar)
    const updateLayoutButtons = () => {
      [elements.layoutRowsBtn, elements.layoutGridBtn, elements.layoutCalendarBtn].forEach(btn => {
        if (btn) btn.classList.remove('active');
      });
      if (state.layoutMode === 'grid' && elements.layoutGridBtn) {
        elements.layoutGridBtn.classList.add('active');
      } else if (state.layoutMode === 'calendar' && elements.layoutCalendarBtn) {
        elements.layoutCalendarBtn.classList.add('active');
      } else if (elements.layoutRowsBtn) {
        elements.layoutRowsBtn.classList.add('active');
      }
    };

    updateLayoutButtons();

    if (elements.layoutRowsBtn) {
      elements.layoutRowsBtn.addEventListener('click', () => {
        state.layoutMode = 'rows';
        localStorage.setItem('pulse_layout_mode', 'rows');
        updateLayoutButtons();
        renderAssignments();
      });
    }

    if (elements.layoutGridBtn) {
      elements.layoutGridBtn.addEventListener('click', () => {
        state.layoutMode = 'grid';
        localStorage.setItem('pulse_layout_mode', 'grid');
        updateLayoutButtons();
        renderAssignments();
      });
    }

    if (elements.layoutCalendarBtn) {
      elements.layoutCalendarBtn.addEventListener('click', () => {
        state.layoutMode = 'calendar';
        localStorage.setItem('pulse_layout_mode', 'calendar');
        updateLayoutButtons();
        renderAssignments();
      });
    }

    // Search Filter
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderAssignments();
    });

    // Toolbar Action Listeners
    elements.markDoneBtn.addEventListener('click', markSelectedAsDone);
    elements.selectAllBtn.addEventListener('click', selectAllVisible);
    elements.clearSelectionBtn.addEventListener('click', clearSelection);

    // File Drag & Drop Listeners
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });

    elements.fileDropZone.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    });

    // Add Canvas Feed Button Handler
    elements.addCanvasFeedBtn.addEventListener('click', async () => {
      const urlVal = elements.canvasUrlInput.value.trim();
      if (!urlVal) {
        showToast('Please enter a Canvas feed URL or paste .ics text.');
        return;
      }

      elements.addCanvasFeedBtn.disabled = true;
      elements.addCanvasFeedBtn.textContent = '⏳ Loading...';

      try {
        const text = await fetchIcalFeed(urlVal);
        const parsed = window.IcalParser.parseIcalContent(text, 'Canvas');

        if (parsed.assignments.length === 0) {
          showToast('No assignments found in Canvas feed.');
        } else {
          state.canvasFeedUrl = urlVal;
          mergeNewAssignments(parsed.assignments);
          showToast(`Added Canvas feed with ${parsed.assignments.length} assignments!`);
        }
      } catch (err) {
        showToast(err.message);
      } finally {
        elements.addCanvasFeedBtn.disabled = false;
        elements.addCanvasFeedBtn.textContent = '➕ Add Canvas Feed';
        renderModalCourseLists();
      }
    });

    // Add Individual Learning Suite Course Listener
    elements.addLsCourseBtn.addEventListener('click', async () => {
      const nameVal = elements.addLsCourseName.value.trim();
      const urlVal = elements.addLsCourseUrl.value.trim();

      if (!urlVal) {
        showToast('Please enter a Learning Suite course feed URL or paste .ics text.');
        return;
      }

      elements.addLsCourseBtn.disabled = true;
      elements.addLsCourseBtn.textContent = '⏳ Fetching Course...';

      try {
        const text = await fetchIcalFeed(urlVal);
        const parsed = window.IcalParser.parseIcalContent(text, 'Learning Suite');

        const courseName = nameVal || parsed.calendarName || `LS Course ${state.lsCourses.length + 1}`;
        const color = getCourseColor(courseName);

        parsed.assignments.forEach(a => {
          a.courseName = courseName;
        });

        const newCourse = {
          id: 'ls_' + Date.now(),
          name: courseName,
          url: urlVal,
          color
        };

        state.lsCourses.push(newCourse);
        mergeNewAssignments(parsed.assignments);

        elements.addLsCourseName.value = '';
        elements.addLsCourseUrl.value = '';

        showToast(`Added Learning Suite course: ${courseName} (${parsed.assignments.length} assignments)!`);
      } catch (err) {
        showToast(err.message);
      } finally {
        elements.addLsCourseBtn.disabled = false;
        elements.addLsCourseBtn.textContent = '➕ Add Learning Suite Course';
        renderModalCourseLists();
      }
    });

    // Modal Feeds / Sign-In Dialog Listeners
    if (elements.modalUploadIcsBtn && elements.modalIcsFileInput) {
      elements.modalUploadIcsBtn.addEventListener('click', () => {
        elements.modalIcsFileInput.click();
      });

      elements.modalIcsFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFiles(e.target.files);
          e.target.value = '';
          renderModalCourseLists();
          renderCoursePills();
          renderAssignments();
        }
      });
    }

    elements.addFeedsBtn.addEventListener('click', () => {
      elements.canvasUrlInput.value = state.canvasFeedUrl;
      elements.profileNameInput.value = state.userProfile === 'Guest' ? '' : state.userProfile;
      if (elements.toggleShowUndatedCheckbox) {
        elements.toggleShowUndatedCheckbox.checked = state.showUndated;
      }
      renderModalCourseLists();
      elements.feedsModal.classList.add('active');
    });

    if (elements.toggleShowUndatedCheckbox) {
      elements.toggleShowUndatedCheckbox.checked = state.showUndated;
      elements.toggleShowUndatedCheckbox.addEventListener('change', (e) => {
        state.showUndated = e.target.checked;
        localStorage.setItem('pulse_show_undated', state.showUndated ? 'true' : 'false');
        renderAssignments();
        showToast(state.showUndated ? 'Showing assignments with no open/close date' : 'Hiding assignments with no open/close date');
      });
    }

    elements.closeFeedsModalBtn.addEventListener('click', () => {
      elements.feedsModal.classList.remove('active');
    });

    elements.continueGuestBtn.addEventListener('click', () => {
      state.userProfile = 'Guest';
      elements.profileLabel.textContent = 'Guest';
      saveState();
      elements.feedsModal.classList.remove('active');
    });

    elements.saveFeedsBtn.addEventListener('click', () => {
      state.canvasFeedUrl = elements.canvasUrlInput.value.trim();
      const profileVal = elements.profileNameInput.value.trim();
      state.userProfile = profileVal || 'Guest';
      elements.profileLabel.textContent = state.userProfile;
      saveState();
      elements.feedsModal.classList.remove('active');
      syncFeedUrls();
    });

    // Export Modal Listeners
    if (elements.exportBtn) {
      elements.exportBtn.addEventListener('click', () => {
        updateExportSummary();
        elements.exportModal.classList.add('active');
      });
    }

    if (elements.closeExportModalBtn) {
      elements.closeExportModalBtn.addEventListener('click', () => {
        elements.exportModal.classList.remove('active');
      });
    }

    if (elements.exportModal) {
      elements.exportModal.addEventListener('click', (e) => {
        if (e.target === elements.exportModal) elements.exportModal.classList.remove('active');
      });
    }

    [elements.exportOptUncompleted, elements.exportOptAll].forEach(radio => {
      if (radio) radio.addEventListener('change', updateExportSummary);
    });

    if (elements.confirmExportBtn) {
      elements.confirmExportBtn.addEventListener('click', () => {
        const exportAll = elements.exportOptAll && elements.exportOptAll.checked;
        const toExport = exportAll
          ? state.assignments
          : state.assignments.filter(a => !state.completedHashes.has(a.id));

        if (toExport.length === 0) {
          showToast('No assignments to export.');
          return;
        }

        const ical = generateIcalExport(toExport);
        const date = new Date().toISOString().slice(0, 10);
        const filename = exportAll
          ? `assignment-pulse-all-${date}.ics`
          : `assignment-pulse-active-${date}.ics`;

        downloadIcalFile(ical, filename);
        elements.exportModal.classList.remove('active');
        showToast(`Exported ${toExport.length} assignment${toExport.length !== 1 ? 's' : ''} to ${filename}`);
      });
    }

    // PWA Install Prompt Handler
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      elements.installAppBtn.style.display = 'inline-flex';
    });

    elements.installAppBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          elements.installAppBtn.style.display = 'none';
        }
        deferredInstallPrompt = null;
      }
    });

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('Service Worker registration failed:', err);
      });
    }

    // Initial Load & Sync
    renderCoursePills();
    renderAssignments();
    syncFeedUrls();

    // Auto-sync every 30 minutes while the page is open
    setInterval(syncFeedUrls, SYNC_INTERVAL_MS);
  });

})();
