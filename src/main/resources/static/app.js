const byId = (id) => document.getElementById(id);
const editor = byId('editor');
const roleNames = {
  SUPER_ADMIN: 'Суперадминистратор',
  ADMIN: 'Администратор',
  TEACHER: 'Преподаватель',
};
const sections = {
  students: { title: 'Студенты', path: '/student', listKey: 'response' },
  users: { title: 'Учётные записи', path: '/users', listKey: 'responses' },
};

let session;
let expiryTimer;
let section;
let rows = [];
let listRequest = 0;
let recordRequest = 0;
let mutate;
let remove;

function message(id, value = '') {
  const target = byId(id);
  target.textContent = value;
  target.hidden = !value;
}

function signOut(reason = '') {
  clearTimeout(expiryTimer);
  session = undefined;
  listRequest++;
  recordRequest++;
  editor.close();
  byId('fields').replaceChildren();
  byId('records').replaceChildren();
  byId('identity').textContent = '';
  rows = [];
  byId('account').hidden = true;
  byId('dashboard').hidden = true;
  byId('login').hidden = false;
  byId('login-form').elements.password.value = '';
  message('login-error', reason);
}

async function request(path, method = 'GET', body) {
  const activeSession = session;
  const headers = { Accept: 'application/json' };
  if (activeSession) headers.Authorization = 'Bearer ' + activeSession.token;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch('/api/v1' + path, { method, headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('Не удалось связаться с сервером.');
  }
  if (activeSession && activeSession !== session) throw new Error('Сеанс завершён.');
  if (response.status === 401 && activeSession) {
    signOut('Сеанс завершён. Войдите снова.');
    throw new Error('Сеанс завершён.');
  }
  if ([401, 403].includes(response.status) && path === '/auth/login') {
    throw new Error('Не удалось войти. Проверьте email и пароль.');
  }
  if (response.status === 403) throw new Error('У вас нет доступа к этому действию.');
  if (response.status === 404) throw new Error('Запись не найдена.');
  if (response.status === 409) throw new Error('Такая запись уже существует.');
  if (!response.ok) throw new Error('Сервер вернул ошибку (' + response.status + ').');
  const content = await response.text();
  return content ? JSON.parse(content) : null;
}

function hasRole(role) {
  return session.roles.includes('ROLE_' + role);
}

function canEdit() {
  return section === 'users' || hasRole('ADMIN');
}

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = event.submitter;
  const credentials = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  message('login-error');
  try {
    session = await request('/auth/login', 'POST', credentials);
    const allowed = [];
    if (hasRole('ADMIN') || hasRole('TEACHER')) allowed.push('students');
    if (hasRole('SUPER_ADMIN')) allowed.push('users');
    if (!allowed.length) {
      signOut('У вашей учётной записи нет доступа к разделам кабинета.');
      return;
    }
    expiryTimer = setTimeout(() => signOut('Сеанс завершён. Войдите снова.'), session.expiresIn * 1000);
    byId('identity').textContent = credentials.email;
    form.reset();
    byId('login').hidden = true;
    byId('account').hidden = false;
    byId('dashboard').hidden = false;
    const navigation = byId('navigation');
    navigation.replaceChildren();
    for (const key of allowed) {
      const button = document.createElement('button');
      button.textContent = sections[key].title;
      button.dataset.section = key;
      button.addEventListener('click', () => selectSection(key));
      navigation.append(button);
    }
    selectSection(allowed[0]);
  } catch (error) {
    signOut(error.message);
  } finally {
    submit.disabled = false;
  }
});

function selectSection(key) {
  section = key;
  byId('title').textContent = sections[key].title;
  byId('add').hidden = !canEdit();
  byId('search').value = '';
  for (const button of byId('navigation').children) {
    const selected = button.dataset.section === key;
    button.classList.toggle('secondary', !selected);
    button.setAttribute('aria-pressed', selected);
  }
  loadRows();
}

async function loadRows() {
  const revision = ++listRequest;
  const config = sections[section];
  rows = [];
  byId('records').replaceChildren();
  byId('count').textContent = '';
  byId('retry').hidden = true;
  byId('search').disabled = true;
  message('status', 'Загрузка…');
  try {
    const response = await request(config.path);
    if (revision !== listRequest) return;
    rows = response[config.listKey];
    byId('search').disabled = false;
    renderRows();
  } catch (error) {
    if (revision !== listRequest) return;
    message('status', error.message);
    byId('retry').hidden = false;
  }
}

function studentName(student) {
  return [student.name, student.surname].filter(Boolean).join(' ') || 'Студент №' + student.id;
}

function renderRows() {
  const query = byId('search').value.trim().toLocaleLowerCase('ru');
  const records = byId('records');
  records.replaceChildren();
  let shown = 0;
  for (const row of rows) {
    const label = section === 'students' ? studentName(row) : row.email;
    if (!label.toLocaleLowerCase('ru').includes(query)) continue;
    shown++;
    const item = document.createElement('li');
    const button = document.createElement('button');
    const subtitle = document.createElement('small');
    button.className = 'record';
    button.textContent = label;
    subtitle.textContent = section === 'students'
      ? '№ ' + row.id
      : row.roles.map((role) => roleNames[role] ?? role).join(', ');
    button.append(subtitle);
    button.addEventListener('click', () => openRecord(row));
    item.append(button);
    records.append(item);
  }
  byId('count').textContent = query ? 'Найдено: ' + shown + ' из ' + rows.length : 'Всего: ' + rows.length;
  message('status', shown ? '' : query ? 'Совпадений нет.' : 'Записей пока нет.');
}

function field(label, name, type, value = '', { required = false, readOnly = false } = {}) {
  const wrapper = document.createElement('label');
  const input = document.createElement('input');
  wrapper.textContent = label;
  input.name = name;
  input.type = type;
  input.value = value ?? '';
  input.required = required;
  input.readOnly = readOnly;
  if (type === 'password') input.autocomplete = 'new-password';
  wrapper.append(input);
  byId('fields').append(wrapper);
}

function roleFields(selected = []) {
  const group = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Роли';
  group.append(legend);
  for (const [role, label] of Object.entries(roleNames)) {
    const wrapper = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'roles';
    input.value = role;
    input.checked = selected.includes(role);
    wrapper.append(input, ' ' + label);
    group.append(wrapper);
  }
  byId('fields').append(group);
}

async function openRecord(row) {
  const revision = ++recordRequest;
  const isStudent = section === 'students';
  const path = sections[section].path;
  const editable = canEdit();
  mutate = undefined;
  remove = undefined;
  byId('fields').replaceChildren();
  byId('save').hidden = true;
  byId('remove').hidden = true;
  message('editor-error');
  byId('editor-title').textContent = row
    ? (isStudent ? studentName(row) : row.email)
    : (isStudent ? 'Новый студент' : 'Новая учётная запись');
  editor.showModal();
  try {
    let record = row;
    if (isStudent && row) {
      byId('fields').textContent = 'Загрузка…';
      record = await request(path + '/' + row.id);
      if (revision !== recordRequest || !editor.open) return;
      byId('fields').replaceChildren();
    }
    if (isStudent) {
      if (!record) {
        field('Имя', 'name', 'text', '', { required: true });
        field('Фамилия', 'surname', 'text', '', { required: true });
      }
      field('Телефон', record ? 'phoneNumber' : 'phone_number', 'tel', record?.phoneNumber, { readOnly: !editable });
      field('Email', 'email', 'email', record?.email, { readOnly: !editable });
    } else {
      field('Email', 'email', 'email', record?.email, { required: true, readOnly: Boolean(record) });
      if (!record) field('Пароль', 'password', 'password', '', { required: true });
      roleFields(record?.roles);
    }
    if (!editable) return;
    byId('save').hidden = false;
    mutate = (data) => {
      const payload = Object.fromEntries(data);
      if (!isStudent) {
        payload.roles = data.getAll('roles');
        if (!payload.roles.length) throw new Error('Выберите хотя бы одну роль.');
      }
      return record ? request(path + '/' + record.id, 'PUT', payload) : request(path + '/save', 'POST', payload);
    };
    if (record && (isStudent || record.email !== byId('identity').textContent)) {
      byId('remove').hidden = false;
      remove = () => request(path + '/' + record.id, 'DELETE');
    }
  } catch (error) {
    if (revision === recordRequest && editor.open) {
      byId('fields').replaceChildren();
      message('editor-error', error.message);
    }
  }
}

async function runMutation(action) {
  const buttons = [...editor.querySelectorAll('button')];
  for (const button of buttons) button.disabled = true;
  message('editor-error');
  try {
    await action();
    editor.close();
    await loadRows();
  } catch (error) {
    if (editor.open) message('editor-error', error.message);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

byId('logout').addEventListener('click', () => signOut());
byId('search').addEventListener('input', renderRows);
byId('retry').addEventListener('click', loadRows);
byId('add').addEventListener('click', () => openRecord());
byId('close').addEventListener('click', () => editor.close());
editor.addEventListener('cancel', (event) => {
  if (byId('close').disabled) event.preventDefault();
});
byId('editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (mutate && !byId('save').disabled) {
    const data = new FormData(event.currentTarget);
    runMutation(() => mutate(data));
  }
});
byId('remove').addEventListener('click', () => {
  if (remove && window.confirm('Удалить эту запись?')) runMutation(remove);
});
