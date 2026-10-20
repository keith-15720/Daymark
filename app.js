(function () {
  if (typeof document === 'undefined') { return; }

  var STORAGE_KEY = 'daymark.tasks.v1';
  var APPEARANCE_KEY = 'daymark.appearance.v1';
  var DEFAULT_CATEGORIES = ['Personal', 'Work', 'Errands'];
  var GRADIENTS = ['forest', 'ocean', 'sunset', 'lavender', 'rose'];
  var localBackup = loadState();
  var state = { tasks: [], categories: DEFAULT_CATEGORIES.slice(0) };
  var appearance = loadAppearance();
  var supabaseClient = null;
  var currentUser = null;
  var accountReady = false;
  var accountLoadFailed = false;
  var authRequestId = 0;
  var authMode = 'signin';
  var activeUserId = '';
  var activeView = 'all';
  var activeCategory = '';
  var lastFocusedElement = null;

  var elements = {
    taskList: document.getElementById('taskList'),
    emptyState: document.getElementById('emptyState'),
    emptyTitle: document.getElementById('emptyTitle'),
    emptyMessage: document.getElementById('emptyMessage'),
    searchInput: document.getElementById('searchInput'),
    statusFilter: document.getElementById('statusFilter'),
    dateFilter: document.getElementById('dateFilter'),
    priorityFilter: document.getElementById('priorityFilter'),
    categoryFilter: document.getElementById('categoryFilter'),
    sortSelect: document.getElementById('sortSelect'),
    taskModal: document.getElementById('taskModal'),
    taskForm: document.getElementById('taskForm'),
    taskId: document.getElementById('taskId'),
    taskTitle: document.getElementById('taskTitle'),
    taskDetails: document.getElementById('taskDetails'),
    taskCategory: document.getElementById('taskCategory'),
    taskPriority: document.getElementById('taskPriority'),
    taskDueDate: document.getElementById('taskDueDate'),
    categoryModal: document.getElementById('categoryModal'),
    categoryForm: document.getElementById('categoryForm'),
    categoryName: document.getElementById('categoryName'),
    categoryNav: document.getElementById('categoryNav'),
    toastRegion: document.getElementById('toastRegion'),
    sidebar: document.getElementById('sidebar'),
    mobileMenuButton: document.getElementById('mobileMenuButton'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    themeSelect: document.getElementById('themeSelect'),
    gradientSelect: document.getElementById('gradientSelect'),
    appearanceStatus: document.getElementById('appearanceStatus'),
    authGate: document.getElementById('authGate'),
    authForm: document.getElementById('authForm'),
    authEmail: document.getElementById('authEmail'),
    authPassword: document.getElementById('authPassword'),
    authTitle: document.getElementById('authTitle'),
    authDescription: document.getElementById('authDescription'),
    authStatus: document.getElementById('authStatus'),
    authSubmitButton: document.getElementById('authSubmitButton'),
    authModeButton: document.getElementById('authModeButton'),
    authSetupNotice: document.getElementById('authSetupNotice'),
    retryLoadButton: document.getElementById('retryLoadButton'),
    accountControl: document.getElementById('accountControl'),
    accountEmail: document.getElementById('accountEmail'),
    signOutButton: document.getElementById('signOutButton')
  };

  function loadState() {
    var stored;
    try {
      stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      stored = null;
    }
    if (stored && Object.prototype.toString.call(stored.tasks) === '[object Array]') {
      return {
        tasks: stored.tasks.filter(function (task) { return task && task.id && task.title; }),
        categories: normalizeCategories(stored.categories)
      };
    }
    return { tasks: [], categories: DEFAULT_CATEGORIES.slice(0) };
  }

  function loadAppearance() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(APPEARANCE_KEY) || 'null');
      return {
        theme: stored && stored.theme === 'dark' ? 'dark' : 'light',
        gradient: stored && GRADIENTS.indexOf(stored.gradient) !== -1 ? stored.gradient : 'forest'
      };
    } catch (error) {
      return { theme: 'light', gradient: 'forest' };
    }
  }

  function applyAppearance() {
    document.documentElement.setAttribute('data-theme', appearance.theme);
    document.documentElement.setAttribute('data-gradient', appearance.gradient);
    elements.themeSelect.value = appearance.theme;
    elements.gradientSelect.value = appearance.gradient;
    elements.appearanceStatus.textContent =
      appearance.gradient.charAt(0).toUpperCase() + appearance.gradient.slice(1) +
      ' gradient · ' + (appearance.theme === 'dark' ? 'dark' : 'light') + ' theme';
    document.querySelector('meta[name="theme-color"]').setAttribute(
      'content',
      appearance.theme === 'dark' ? '#151f1b' : '#1c2d29'
    );
  }

  function saveAppearance() {
    try {
      window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    } catch (error) {
      showToast('Could not save your appearance settings on this device.', true);
    }
  }

  function normalizeCategories(categories) {
    var result = [];
    if (Object.prototype.toString.call(categories) === '[object Array]') {
      categories.forEach(function (category) {
        if (typeof category === 'string' && category.trim() && !containsCategory(result, category.trim())) {
          result.push(category.trim());
        }
      });
    }
    return result.length ? result : DEFAULT_CATEGORIES.slice(0);
  }

  function containsCategory(list, name) {
    var target = String(name).toLowerCase();
    return list.some(function (item) { return String(item).toLowerCase() === target; });
  }

  function taskFromRow(row) {
    return {
      id: row.id,
      title: row.title,
      details: row.details || '',
      category: row.category || '',
      priority: row.priority || 'medium',
      dueDate: row.due_date || '',
      completed: Boolean(row.completed),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  function taskToRow(task) {
    return {
      id: task.id,
      title: task.title,
      details: task.details,
      category: task.category,
      priority: task.priority,
      due_date: task.dueDate || null,
      completed: task.completed,
      created_at: task.createdAt,
      updated_at: task.updatedAt
    };
  }

  function setAuthStatus(message, isError) {
    elements.authStatus.textContent = message || '';
    elements.authStatus.classList.toggle('is-error', Boolean(isError));
  }

  function renderAuthState() {
    var signedIn = Boolean(currentUser);
    var ready = signedIn && accountReady;
    elements.authGate.hidden = ready;
    elements.accountControl.hidden = !signedIn;
    elements.accountEmail.textContent = signedIn ? currentUser.email : '';
    elements.authForm.hidden = !supabaseClient || signedIn;
    elements.authModeButton.hidden = !supabaseClient || signedIn;
    elements.retryLoadButton.hidden = !signedIn || !accountLoadFailed;
    document.body.classList.toggle('auth-required', !ready);
  }

  function authErrorMessage(error) {
    if (!error || !error.message) { return 'Something went wrong. Please try again.'; }
    return error.message;
  }

  function isCurrentAuthRequest(user, requestId) {
    return activeUserId === user.id && authRequestId === requestId;
  }

  async function loadCloudState(user, requestId) {
    var taskResult = await supabaseClient
      .from('tasks')
      .select('id,title,details,category,priority,due_date,completed,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (taskResult.error) { throw taskResult.error; }
    if (!isCurrentAuthRequest(user, requestId)) { return; }

    var categoryResult = await supabaseClient
      .from('task_categories')
      .select('name')
      .order('created_at', { ascending: true });
    if (categoryResult.error) { throw categoryResult.error; }
    if (!isCurrentAuthRequest(user, requestId)) { return; }

    var cloudTasks = taskResult.data || [];
    var cloudCategories = categoryResult.data || [];
    var hasExtraLocalCategories = localBackup.categories.some(function (name) {
      return DEFAULT_CATEGORIES.indexOf(name) === -1;
    });

    if (!cloudTasks.length && (localBackup.tasks.length || hasExtraLocalCategories) && window.confirm(
      'This account has no saved tasks yet. Import the tasks and lists already saved in this browser? Only continue if all of that browser data belongs to you.'
    )) {
      if (!isCurrentAuthRequest(user, requestId)) { return; }
      var importedCategories = normalizeCategories(localBackup.categories);
      var existingCategoryNames = cloudCategories.map(function (row) { return row.name.toLowerCase(); });
      var categoriesToInsert = importedCategories.filter(function (name) {
        return existingCategoryNames.indexOf(name.toLowerCase()) === -1;
      });
      if (categoriesToInsert.length) {
        var categoryInsert = await supabaseClient
          .from('task_categories')
          .insert(categoriesToInsert.map(function (name) { return { name: name }; }));
        if (categoryInsert.error) { throw categoryInsert.error; }
        if (!isCurrentAuthRequest(user, requestId)) { return; }
      }

      var importedTasks = localBackup.tasks.filter(function (task) {
        return String(task.title || '').trim();
      }).map(function (task) {
        var imported = {
          id: createId(),
          title: String(task.title).trim().slice(0, 120),
          details: String(task.details || '').slice(0, 500),
          category: task.category || importedCategories[0] || '',
          priority: ['low', 'medium', 'high'].indexOf(task.priority) === -1 ? 'medium' : task.priority,
          dueDate: task.dueDate || '',
          completed: Boolean(task.completed),
          createdAt: Number(task.createdAt) || Date.now(),
          updatedAt: Number(task.updatedAt) || Date.now()
        };
        return imported;
      });
      if (importedTasks.length) {
        var taskInsert = await supabaseClient.from('tasks').insert(importedTasks.map(taskToRow));
        if (taskInsert.error) { throw taskInsert.error; }
        if (!isCurrentAuthRequest(user, requestId)) { return; }
      }
      taskResult.data = importedTasks.map(taskToRow);
      categoryResult.data = cloudCategories.concat(categoriesToInsert.map(function (name) { return { name: name }; }));
      if (importedTasks.length) { showToast('Browser tasks imported to your account.'); }
    }

    if (!categoryResult.data || !categoryResult.data.length) {
      if (!isCurrentAuthRequest(user, requestId)) { return; }
      var defaults = DEFAULT_CATEGORIES.map(function (name) { return { name: name }; });
      var defaultInsert = await supabaseClient
        .from('task_categories')
        .insert(defaults);
      if (defaultInsert.error) { throw defaultInsert.error; }
      if (!isCurrentAuthRequest(user, requestId)) { return; }
      categoryResult.data = defaults;
    }

    if (!isCurrentAuthRequest(user, requestId)) { return; }
    state.tasks = (taskResult.data || []).map(taskFromRow);
    state.categories = normalizeCategories((categoryResult.data || []).map(function (row) { return row.name; }));
    accountReady = true;
    accountLoadFailed = false;
    renderAuthState();
    render();
  }

  async function handleAuthSession(session) {
    var user = session && session.user ? session.user : null;
    if (!user) {
      authRequestId += 1;
      activeUserId = '';
      currentUser = null;
      accountReady = false;
      accountLoadFailed = false;
      state.tasks = [];
      state.categories = DEFAULT_CATEGORIES.slice(0);
      renderAuthState();
      render();
      return;
    }

    if (activeUserId === user.id && currentUser) { return; }
    activeUserId = user.id;
    var requestId = ++authRequestId;
    currentUser = user;
    accountReady = false;
    accountLoadFailed = false;
    renderAuthState();
    setAuthStatus('Loading your tasks…');
    state.tasks = [];
    state.categories = DEFAULT_CATEGORIES.slice(0);
    render();

    try {
      await loadCloudState(user, requestId);
    } catch (error) {
      if (!isCurrentAuthRequest(user, requestId)) { return; }
      accountLoadFailed = true;
      renderAuthState();
      setAuthStatus('Could not load your account data: ' + authErrorMessage(error), true);
      showToast('Could not load your account data. Check your Supabase setup and try again.', true);
    }
  }

  function initializeSupabase() {
    var config = window.DAYMARK_SUPABASE_CONFIG || {};
    var isConfigured = config.url && config.anonKey &&
      config.url.indexOf('YOUR_PROJECT_ID') === -1 &&
      config.anonKey.indexOf('YOUR_SUPABASE_') === -1;

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      elements.authSetupNotice.hidden = false;
      elements.authForm.hidden = true;
      elements.authModeButton.hidden = true;
      setAuthStatus('Could not load Supabase. Check your internet connection and reload.', true);
      renderAuthState();
      return;
    }

    if (!isConfigured) {
      elements.authSetupNotice.hidden = false;
      elements.authForm.hidden = true;
      elements.authModeButton.hidden = true;
      renderAuthState();
      return;
    }

    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
    supabaseClient.auth.onAuthStateChange(function (_event, session) {
      window.setTimeout(function () { handleAuthSession(session); }, 0);
    });
    supabaseClient.auth.getSession().then(function (result) {
      if (result.error) {
        setAuthStatus('Could not restore your sign-in: ' + authErrorMessage(result.error), true);
        return;
      }
      handleAuthSession(result.data.session);
    }).catch(function (error) {
      setAuthStatus('Could not connect to Supabase: ' + authErrorMessage(error), true);
    });
  }

  function localDateString(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1);
    var day = String(date.getDate());
    return year + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function parseLocalDate(value) {
    if (!value) { return null; }
    var parts = value.split('-');
    if (parts.length !== 3) { return null; }
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatDate(value, options) {
    var date = parseLocalDate(value);
    if (!date || isNaN(date.getTime())) { return ''; }
    return date.toLocaleDateString(undefined, options || { month: 'short', day: 'numeric' });
  }

  function startOfToday() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function dueState(value) {
    if (!value) { return ''; }
    var due = parseLocalDate(value);
    if (!due) { return ''; }
    due.setHours(0, 0, 0, 0);
    var today = startOfToday();
    if (due.getTime() < today.getTime()) { return 'overdue'; }
    if (due.getTime() === today.getTime()) { return 'today'; }
    return 'upcoming';
  }

  function makeIconButton(action, label, svg, extraClass) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button ' + (extraClass || '');
    button.setAttribute('data-action', action);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = svg;
    return button;
  }

  function createMetaPill(text, className, icon) {
    var pill = document.createElement('span');
    pill.className = 'meta-pill' + (className ? ' ' + className : '');
    if (icon) {
      var svg = document.createElement('span');
      svg.innerHTML = icon;
      pill.appendChild(svg.firstChild);
    }
    var label = document.createElement('span');
    label.textContent = text;
    pill.appendChild(label);
    return pill;
  }

  function renderTask(task) {
    var row = document.createElement('article');
    row.className = 'task-row' + (task.completed ? ' is-complete' : '');
    row.setAttribute('data-id', task.id);

    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'task-toggle';
    toggle.checked = Boolean(task.completed);
    toggle.setAttribute('aria-label', (task.completed ? 'Restore ' : 'Complete ') + task.title);
    row.appendChild(toggle);

    var main = document.createElement('div');
    main.className = 'task-main';
    var titleLine = document.createElement('div');
    titleLine.className = 'task-title-line';
    var title = document.createElement('h3');
    title.className = 'task-title';
    title.textContent = task.title;
    titleLine.appendChild(title);
    main.appendChild(titleLine);

    if (task.details) {
      var details = document.createElement('p');
      details.className = 'task-details';
      details.textContent = task.details;
      main.appendChild(details);
    }

    var meta = document.createElement('div');
    meta.className = 'task-meta';
    if (task.category) { meta.appendChild(createMetaPill(task.category, '', '')); }
    if (task.priority) {
      meta.appendChild(createMetaPill(task.priority.charAt(0).toUpperCase() + task.priority.slice(1), 'priority-' + task.priority, ''));
    }
    if (task.dueDate) {
      var due = dueState(task.dueDate);
      var dueText = formatDate(task.dueDate);
      if (due === 'overdue') { dueText = 'Overdue · ' + dueText; }
      else if (due === 'today') { dueText = 'Today · ' + dueText; }
      var calendarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3.5v4m8-4v4M4 10h16"/></svg>';
      meta.appendChild(createMetaPill(dueText, due === 'overdue' ? 'due-overdue' : (due === 'today' ? 'due-today' : ''), calendarIcon));
    }
    main.appendChild(meta);
    row.appendChild(main);

    var actions = document.createElement('div');
    actions.className = 'task-actions';
    actions.appendChild(makeIconButton('edit', 'Edit ' + task.title, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z"/></svg>'));
    actions.appendChild(makeIconButton('delete', 'Delete ' + task.title, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 1 13h9l1-13M10 10.5v6m4-6v6"/></svg>', 'delete-button'));
    row.appendChild(actions);
    return row;
  }

  function getVisibleTasks() {
    var today = localDateString(new Date());
    var query = elements.searchInput.value.trim().toLowerCase();
    var tasks = state.tasks.filter(function (task) {
      if (activeView === 'today' && task.dueDate !== today) { return false; }
      if (activeView === 'upcoming' && (!task.dueDate || task.dueDate < today || task.completed)) { return false; }
      if (activeView === 'completed' && !task.completed) { return false; }
      if (activeView === 'category' && task.category !== activeCategory) { return false; }
      if (elements.statusFilter.value === 'active' && task.completed) { return false; }
      if (elements.statusFilter.value === 'completed' && !task.completed) { return false; }
      var due = dueState(task.dueDate);
      if (elements.dateFilter.value === 'overdue' && due !== 'overdue') { return false; }
      if (elements.dateFilter.value === 'today' && due !== 'today') { return false; }
      if (elements.dateFilter.value === 'upcoming' && due !== 'upcoming') { return false; }
      if (elements.dateFilter.value === 'none' && task.dueDate) { return false; }
      if (elements.priorityFilter.value !== 'all' && task.priority !== elements.priorityFilter.value) { return false; }
      if (elements.categoryFilter.value !== 'all' && task.category !== elements.categoryFilter.value) { return false; }
      if (query && (String(task.title).toLowerCase().indexOf(query) === -1 && String(task.details || '').toLowerCase().indexOf(query) === -1)) { return false; }
      return true;
    });

    var priorityRank = { high: 3, medium: 2, low: 1 };
    tasks.sort(function (a, b) {
      if (elements.sortSelect.value === 'priority') { return (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0); }
      if (elements.sortSelect.value === 'status') { return Number(a.completed) - Number(b.completed); }
      if (elements.sortSelect.value === 'category') { return String(a.category || '').localeCompare(String(b.category || '')); }
      if (elements.sortSelect.value === 'recent') { return Number(b.createdAt || 0) - Number(a.createdAt || 0); }
      if (!a.dueDate && !b.dueDate) { return Number(b.createdAt || 0) - Number(a.createdAt || 0); }
      if (!a.dueDate) { return 1; }
      if (!b.dueDate) { return -1; }
      return a.dueDate.localeCompare(b.dueDate);
    });
    return tasks;
  }

  function renderCategoryNav() {
    var counts = {};
    state.tasks.forEach(function (task) { counts[task.category] = (counts[task.category] || 0) + 1; });
    elements.categoryNav.innerHTML = '';
    state.categories.forEach(function (category, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-link' + (activeView === 'category' && activeCategory === category ? ' is-active' : '');
      button.setAttribute('data-category', category);
      var dot = document.createElement('span');
      dot.className = 'category-dot';
      dot.setAttribute('aria-hidden', 'true');
      var name = document.createElement('span');
      name.className = 'category-name';
      name.textContent = category;
      var count = document.createElement('span');
      count.className = 'category-count';
      count.textContent = String(counts[category] || 0);
      button.appendChild(dot);
      button.appendChild(name);
      button.appendChild(count);
      elements.categoryNav.appendChild(button);
    });

    var selected = elements.categoryFilter.value;
    elements.categoryFilter.innerHTML = '';
    var allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All lists';
    elements.categoryFilter.appendChild(allOption);
    state.categories.forEach(function (category) {
      var option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      elements.categoryFilter.appendChild(option);
    });
    elements.categoryFilter.value = selected && (selected === 'all' || containsCategory(state.categories, selected)) ? selected : 'all';

    elements.taskCategory.innerHTML = '';
    state.categories.forEach(function (category) {
      var option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      elements.taskCategory.appendChild(option);
    });
  }

  function viewTitle() {
    if (activeView === 'today') { return 'Today'; }
    if (activeView === 'upcoming') { return 'Upcoming'; }
    if (activeView === 'completed') { return 'Completed tasks'; }
    if (activeView === 'category') { return activeCategory; }
    return 'All tasks';
  }

  function renderSummary() {
    var all = state.tasks.length;
    var completed = state.tasks.filter(function (task) { return Boolean(task.completed); }).length;
    var active = all - completed;
    var today = localDateString(new Date());
    var dueToday = state.tasks.filter(function (task) { return task.dueDate === today && !task.completed; }).length;
    var percent = all ? Math.round(completed / all * 100) : 0;

    document.getElementById('allTaskStat').textContent = String(all);
    document.getElementById('activeTaskStat').textContent = String(active);
    document.getElementById('completedTaskStat').textContent = String(completed);
    document.getElementById('allNavCount').textContent = String(all);
    document.getElementById('todayNavCount').textContent = String(dueToday);
    document.getElementById('completedNavCount').textContent = String(completed);
    document.getElementById('progressPercent').textContent = percent + '%';
    document.getElementById('progressRing').style.setProperty('--progress', (percent * 3.6) + 'deg');
    document.getElementById('progressRing').setAttribute('aria-label', percent + ' percent complete');
    document.getElementById('progressTitle').textContent = all ? (percent === 100 ? 'Look at you — all caught up.' : 'Every small step counts.') : 'Every small step counts.';
    document.getElementById('progressText').textContent = all ? completed + ' of ' + all + ' tasks complete · ' + active + ' still in progress.' : 'Add a task and start building a little momentum.';

    var todayLabel = document.getElementById('todayLabel');
    todayLabel.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    document.getElementById('sectionTitle').textContent = viewTitle();
    var visible = getVisibleTasks();
    document.getElementById('sectionSummary').textContent = visible.length ? visible.length + (visible.length === 1 ? ' task in this view' : ' tasks in this view') : 'A good place to begin.';
  }

  function render() {
    renderCategoryNav();
    renderSummary();
    var tasks = getVisibleTasks();
    elements.taskList.innerHTML = '';
    tasks.forEach(function (task) { elements.taskList.appendChild(renderTask(task)); });
    elements.taskList.hidden = tasks.length === 0;
    elements.emptyState.hidden = tasks.length > 0;
    if (!state.tasks.length) {
      elements.emptyTitle.textContent = 'A little room to think.';
      elements.emptyMessage.textContent = 'Add a first task, then keep it moving one step at a time.';
      document.getElementById('emptyAddButton').textContent = 'Add your first task';
    } else {
      elements.emptyTitle.textContent = 'Nothing here just yet.';
      elements.emptyMessage.textContent = 'Try another filter, or add a task to this list.';
      document.getElementById('emptyAddButton').textContent = 'Add a task';
    }
    document.querySelectorAll('.nav-link').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-view') === activeView && activeView !== 'category');
    });
  }

  function showToast(message, isError) {
    if (!elements.toastRegion) { return; }
    var toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' is-error' : '');
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.textContent = message;
    elements.toastRegion.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) { toast.parentNode.removeChild(toast); }
    }, 3200);
  }

  function openModal(modal, focusTarget) {
    lastFocusedElement = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    window.setTimeout(function () { if (focusTarget) { focusTarget.focus(); } }, 0);
  }

  function closeModal(modal) {
    if (!modal || modal.hidden) { return; }
    modal.hidden = true;
    if (elements.taskModal.hidden && elements.categoryModal.hidden) { document.body.classList.remove('modal-open'); }
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') { lastFocusedElement.focus(); }
  }

  function resetTaskForm() {
    elements.taskForm.reset();
    elements.taskId.value = '';
    elements.taskPriority.value = 'medium';
    if (state.categories.length) { elements.taskCategory.value = state.categories[0]; }
    document.getElementById('taskModalTitle').textContent = 'New task';
    document.getElementById('saveTaskButton').textContent = 'Save task';
  }

  function openNewTask() {
    resetTaskForm();
    openModal(elements.taskModal, elements.taskTitle);
  }

  function openEditTask(task) {
    resetTaskForm();
    elements.taskId.value = task.id;
    elements.taskTitle.value = task.title;
    elements.taskDetails.value = task.details || '';
    elements.taskCategory.value = task.category || state.categories[0] || '';
    elements.taskPriority.value = task.priority || 'medium';
    elements.taskDueDate.value = task.dueDate || '';
    document.getElementById('taskModalTitle').textContent = 'Edit task';
    document.getElementById('saveTaskButton').textContent = 'Save changes';
    openModal(elements.taskModal, elements.taskTitle);
  }

  function createId() {
    return 'task-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
  }

  elements.authForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!supabaseClient) { return; }
    var email = elements.authEmail.value.trim();
    var password = elements.authPassword.value;
    elements.authSubmitButton.disabled = true;
    setAuthStatus(authMode === 'signin' ? 'Signing in…' : 'Creating your account…');

    try {
      var result = authMode === 'signin'
        ? await supabaseClient.auth.signInWithPassword({ email: email, password: password })
        : await supabaseClient.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: window.location.origin }
        });
      if (result.error) {
        setAuthStatus(authErrorMessage(result.error), true);
      } else if (authMode === 'signup' && !result.data.session) {
        setAuthStatus('Check your email for a confirmation link, then sign in.');
      } else {
        setAuthStatus(authMode === 'signin' ? 'Signed in. Loading your tasks…' : 'Account created. Loading your tasks…');
      }
    } catch (error) {
      setAuthStatus(authErrorMessage(error), true);
    } finally {
      elements.authSubmitButton.disabled = false;
    }
  });

  elements.authModeButton.addEventListener('click', function () {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    elements.authTitle.textContent = authMode === 'signin' ? 'Sign in to Daymark' : 'Create your account';
    elements.authDescription.textContent = authMode === 'signin'
      ? 'Your tasks will sync securely with your account.'
      : 'Create an account to keep your tasks with you on every device.';
    elements.authSubmitButton.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
    elements.authModeButton.textContent = authMode === 'signin' ? 'Create an account' : 'Already have an account? Sign in';
    elements.authPassword.autocomplete = authMode === 'signin' ? 'current-password' : 'new-password';
    setAuthStatus('');
  });

  elements.retryLoadButton.addEventListener('click', async function () {
    if (!supabaseClient || !currentUser) { return; }
    var user = currentUser;
    var requestId = ++authRequestId;
    accountLoadFailed = false;
    setAuthStatus('Loading your tasks…');
    renderAuthState();
    try {
      await loadCloudState(user, requestId);
    } catch (error) {
      if (!isCurrentAuthRequest(user, requestId)) { return; }
      accountLoadFailed = true;
      renderAuthState();
      setAuthStatus('Could not load your account data: ' + authErrorMessage(error), true);
    }
  });

  elements.signOutButton.addEventListener('click', async function () {
    if (!supabaseClient) { return; }
    elements.signOutButton.disabled = true;
    try {
      var result = await supabaseClient.auth.signOut();
      if (result.error) {
        showToast('Could not sign out: ' + authErrorMessage(result.error), true);
        return;
      }
      showToast('You are signed out.');
    } catch (error) {
      showToast('Could not sign out: ' + authErrorMessage(error), true);
    } finally {
      elements.signOutButton.disabled = false;
    }
  });

  elements.taskForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!supabaseClient || !currentUser) {
      showToast('Sign in before saving tasks.', true);
      return;
    }
    var title = elements.taskTitle.value.trim();
    if (!title) { elements.taskTitle.focus(); return; }
    var id = elements.taskId.value;
    var current = id ? state.tasks.filter(function (task) { return task.id === id; })[0] : null;
    var data = {
      id: id || createId(),
      title: title,
      details: elements.taskDetails.value.trim(),
      category: elements.taskCategory.value || state.categories[0] || '',
      priority: elements.taskPriority.value || 'medium',
      dueDate: elements.taskDueDate.value,
      completed: current ? Boolean(current.completed) : false,
      createdAt: current ? (current.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };
    var saveButton = document.getElementById('saveTaskButton');
    saveButton.disabled = true;
    try {
      var result = await supabaseClient.from('tasks').upsert(taskToRow(data)).select().single();
      if (result.error) { throw result.error; }
      var savedTask = taskFromRow(result.data);
      if (current) {
        state.tasks = state.tasks.map(function (task) { return task.id === id ? savedTask : task; });
      } else {
        state.tasks.unshift(savedTask);
      }
      closeModal(elements.taskModal);
      render();
      showToast(current ? 'Task updated and synced.' : 'Task saved to your account.');
    } catch (error) {
      showToast('Could not save task: ' + authErrorMessage(error), true);
    } finally {
      saveButton.disabled = false;
    }
  });

  elements.categoryForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!supabaseClient || !currentUser) {
      showToast('Sign in before creating lists.', true);
      return;
    }
    var name = elements.categoryName.value.trim();
    if (!name) { elements.categoryName.focus(); return; }
    if (containsCategory(state.categories, name)) {
      showToast('That list already exists.', true);
      elements.categoryName.focus();
      return;
    }
    var submitButton = elements.categoryForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      var result = await supabaseClient.from('task_categories').insert({ name: name }).select('name').single();
      if (result.error) { throw result.error; }
      state.categories.push(result.data.name);
      closeModal(elements.categoryModal);
      elements.categoryForm.reset();
      activeView = 'category';
      activeCategory = name;
      render();
      showToast('List saved to your account.');
    } catch (error) {
      showToast('Could not create list: ' + authErrorMessage(error), true);
      elements.categoryName.focus();
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById('newTaskButton').addEventListener('click', openNewTask);
  document.getElementById('sectionAddButton').addEventListener('click', openNewTask);
  document.getElementById('emptyAddButton').addEventListener('click', openNewTask);
  document.getElementById('addCategoryButton').addEventListener('click', function () {
    elements.categoryForm.reset();
    openModal(elements.categoryModal, elements.categoryName);
  });

  document.querySelectorAll('[data-close-modal]').forEach(function (button) {
    button.addEventListener('click', function () { closeModal(document.getElementById(button.getAttribute('data-close-modal'))); });
  });
  [elements.taskModal, elements.categoryModal].forEach(function (modal) {
    modal.addEventListener('click', function (event) { if (event.target === modal) { closeModal(modal); } });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeModal(elements.taskModal);
      closeModal(elements.categoryModal);
      closeSidebar();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      elements.searchInput.focus();
    }
  });

  document.querySelectorAll('.nav-link').forEach(function (button) {
    button.addEventListener('click', function () {
      activeView = button.getAttribute('data-view');
      activeCategory = '';
      if (activeView === 'category') { activeView = 'all'; }
      closeSidebar();
      render();
    });
  });
  elements.categoryNav.addEventListener('click', function (event) {
    var button = event.target;
    while (button && button !== elements.categoryNav && !button.getAttribute('data-category')) { button = button.parentNode; }
    if (!button || button === elements.categoryNav) { return; }
    activeView = 'category';
    activeCategory = button.getAttribute('data-category');
    closeSidebar();
    render();
  });

  elements.taskList.addEventListener('change', async function (event) {
    if (!event.target.classList.contains('task-toggle')) { return; }
    var row = event.target.parentNode;
    while (row && !row.getAttribute('data-id')) { row = row.parentNode; }
    if (!row) { return; }
    var id = row.getAttribute('data-id');
    var completed = event.target.checked;
    var updatedAt = Date.now();
    event.target.disabled = true;
    try {
      var result = await supabaseClient.from('tasks')
        .update({ completed: completed, updated_at: updatedAt })
        .eq('id', id)
        .select('id')
        .single();
      if (result.error) { throw result.error; }
      state.tasks = state.tasks.map(function (task) {
        if (task.id === id) { task.completed = completed; task.updatedAt = updatedAt; }
        return task;
      });
      render();
      showToast(completed ? 'Task completed and synced.' : 'Task restored and synced.');
    } catch (error) {
      render();
      showToast('Could not update task: ' + authErrorMessage(error), true);
    }
  });

  elements.taskList.addEventListener('click', async function (event) {
    var button = event.target;
    while (button && button !== elements.taskList && !button.getAttribute('data-action')) { button = button.parentNode; }
    if (!button || button === elements.taskList) { return; }
    var row = button;
    while (row && !row.getAttribute('data-id')) { row = row.parentNode; }
    if (!row) { return; }
    var task = state.tasks.filter(function (item) { return item.id === row.getAttribute('data-id'); })[0];
    if (!task) { return; }
    if (button.getAttribute('data-action') === 'edit') { openEditTask(task); }
    if (button.getAttribute('data-action') === 'delete') {
      if (!window.confirm('Delete “' + task.title + '”? This cannot be undone.')) { return; }
      button.disabled = true;
      try {
        var result = await supabaseClient.from('tasks')
          .delete()
          .eq('id', task.id)
          .select('id')
          .single();
        if (result.error) { throw result.error; }
        state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; });
        render();
        showToast('Task deleted from your account.');
      } catch (error) {
        button.disabled = false;
        showToast('Could not delete task: ' + authErrorMessage(error), true);
      }
    }
  });

  [elements.searchInput, elements.statusFilter, elements.dateFilter, elements.priorityFilter, elements.categoryFilter, elements.sortSelect].forEach(function (control) {
    control.addEventListener('input', render);
    control.addEventListener('change', render);
  });

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    elements.sidebarBackdrop.hidden = true;
    elements.mobileMenuButton.setAttribute('aria-expanded', 'false');
  }
  elements.mobileMenuButton.addEventListener('click', function () {
    var opening = !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', opening);
    elements.sidebarBackdrop.hidden = !opening;
    elements.mobileMenuButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
  elements.sidebarBackdrop.addEventListener('click', closeSidebar);

  elements.themeSelect.addEventListener('change', function () {
    appearance.theme = elements.themeSelect.value === 'dark' ? 'dark' : 'light';
    applyAppearance();
    saveAppearance();
  });
  elements.gradientSelect.addEventListener('change', function () {
    var selectedGradient = elements.gradientSelect.value;
    appearance.gradient = GRADIENTS.indexOf(selectedGradient) !== -1 ? selectedGradient : 'forest';
    applyAppearance();
    saveAppearance();
  });

  applyAppearance();
  renderAuthState();
  render();
  initializeSupabase();
}());
console.log("Hello, World!");