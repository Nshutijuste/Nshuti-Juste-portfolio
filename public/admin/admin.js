(function () {
  'use strict';
  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var state = { content: null, tab: 'general', dirty: false, unread: 0, isDefault: false, saving: false };

  /* ---------- helpers ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  var toastTimer;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3200);
  }
  function api(method, url, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url !== '/api/admin/login') { showLogin(); throw new Error('Your session has ended. Please log in again.'); }
        if (!r.ok) throw new Error(j.error || 'Request failed.');
        return j;
      });
    });
  }
  function dirty() {
    state.dirty = true;
    var s = document.getElementById('saveState');
    if (s) { s.textContent = 'Unsaved changes'; s.className = 'state dirty'; }
    var b = document.getElementById('saveBtn');
    if (b) b.disabled = false;
  }
  window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- field builders ---------- */
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { text: label }), input, hint && h('span', { class: 'hint', text: hint }));
  }
  function text(label, obj, key, opts) {
    opts = opts || {};
    var el = opts.area
      ? h('textarea', { rows: opts.rows || 4, value: obj[key] || '', placeholder: opts.placeholder || '' })
      : h('input', { type: opts.type || 'text', value: obj[key] || '', placeholder: opts.placeholder || '' });
    el.addEventListener('input', function () { obj[key] = el.value; dirty(); });
    return field(label, el, opts.hint);
  }
  function listText(label, obj, key, opts) { // array of strings <-> comma or line separated text
    opts = opts || {};
    var sep = opts.lines ? '\n' : ', ';
    var el = opts.lines || opts.area
      ? h('textarea', { rows: opts.rows || 5, value: (obj[key] || []).join(sep) })
      : h('input', { type: 'text', value: (obj[key] || []).join(sep) });
    el.addEventListener('input', function () {
      var parts = opts.lines ? el.value.split(/\n{2,}/) : el.value.split(',');
      obj[key] = parts.map(function (x) { return x.trim(); }).filter(Boolean);
      dirty();
    });
    return field(label, el, opts.hint);
  }
  function imageField(label, obj, key, hint) {
    var thumb = h('div', { class: 'thumb' });
    function paint() {
      clear(thumb);
      if (obj[key]) thumb.appendChild(h('img', { src: obj[key], alt: '' }));
      else thumb.appendChild(document.createTextNode('No image'));
    }
    paint();
    var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      var fd = new FormData();
      fd.append('image', file.files[0]);
      toast('Uploading image...');
      api('POST', '/api/admin/upload', fd).then(function (r) {
        obj[key] = r.url; paint(); dirty(); toast('Image uploaded. Remember to save changes.');
      }).catch(function (e) { toast(e.message, true); });
      file.value = '';
    });
    var box = h('div', { class: 'img-field' }, thumb,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', text: 'Upload image', onclick: function () { file.click(); } }),
        h('button', { class: 'btn sm', type: 'button', text: 'Choose from library', onclick: function () { openLibrary(function (url) { obj[key] = url; paint(); dirty(); }); } }),
        h('button', { class: 'btn sm danger', type: 'button', text: 'Remove', onclick: function () { obj[key] = ''; paint(); dirty(); } })
      ), file);
    return h('div', { class: 'field' }, h('span', { text: label }), box, hint && h('span', { class: 'hint', text: hint }));
  }
  function move(arr, i, d, rerender) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    dirty(); rerender();
  }
  function rowButtons(arr, i, rerender) {
    return h('span', { class: 'row', onclick: function (e) { e.preventDefault(); e.stopPropagation(); } },
      h('button', { class: 'btn sm', type: 'button', text: 'Up', 'aria-label': 'Move up', onclick: function () { move(arr, i, -1, rerender); } }),
      h('button', { class: 'btn sm', type: 'button', text: 'Down', 'aria-label': 'Move down', onclick: function () { move(arr, i, 1, rerender); } }),
      h('button', { class: 'btn sm danger', type: 'button', text: 'Delete', onclick: function () {
        if (confirm('Delete this item? This cannot be undone once you save.')) { arr.splice(i, 1); dirty(); rerender(); }
      } })
    );
  }

  /* ---------- media library dialog ---------- */
  function openLibrary(onPick) {
    var dlg = h('dialog', {});
    var grid = h('div', { class: 'media-grid' });
    dlg.appendChild(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' },
      h('h2', { text: 'Image library' }),
      h('button', { class: 'btn sm', type: 'button', text: 'Close', onclick: function () { dlg.close(); } })));
    dlg.appendChild(grid);
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    api('GET', '/api/admin/uploads').then(function (files) {
      if (!files.length) grid.appendChild(h('p', { class: 'hint', text: 'No images uploaded yet.' }));
      files.forEach(function (f) {
        grid.appendChild(h('div', { class: 'media-item' }, h('img', { src: f.url, alt: '' }),
          h('div', { class: 'row' }, h('button', { class: 'btn sm primary', type: 'button', text: 'Use', onclick: function () { onPick(f.url); dlg.close(); } }))));
      });
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------- tabs ---------- */
  var TABS = [
    ['general', 'General'], ['about', 'About'], ['skills', 'Skills'], ['projects', 'Projects'],
    ['journey', 'Journey'], ['messages', 'Messages'], ['media', 'Images'], ['security', 'Security'],
  ];

  function tabGeneral(p, c) {
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Main details' }), h('p', { class: 'hint', text: 'Shown in the top section of the website and in the browser tab.' }),
      h('div', { class: 'grid2' }, text('Full name', c.site, 'name'), text('Role or title', c.site, 'role')),
      text('Introduction sentence', c.site, 'tagline', { area: true, rows: 3 }),
      h('div', { class: 'grid2' }, text('Location', c.site, 'location'), text('Contact email', c.site, 'email', { type: 'email' })),
      text('Availability message', c.site, 'availability', { hint: 'Leave empty to hide the green status badge.' })));
    var accent = h('input', { type: 'color', value: c.site.accent });
    accent.addEventListener('input', function () { c.site.accent = accent.value; dirty(); });
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Photo and appearance' }),
      imageField('Profile photo', c.site, 'profileImage', 'A portrait works best (4:5 ratio). Without a photo, your initials are shown.'),
      field('Accent colour', accent, 'Used for buttons, links and highlights across the site.'),
      text('Link to your CV', c.site, 'resumeUrl', { placeholder: 'https://...', hint: 'Optional. Paste a link to your CV (for example a shared PDF). A download button appears when this is filled in.' })));
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Search engines and footer' }),
      text('Page description', c.site, 'metaDescription', { area: true, rows: 2, hint: 'Shown in Google search results.' }),
      text('Footer text', c.site, 'footerText', { hint: 'The year is added automatically.' })));
    var soc = h('div', {});
    function paintSoc() {
      clear(soc);
      c.socials.forEach(function (s, i) {
        soc.appendChild(h('div', { class: 'grid2', style: 'align-items:end' },
          text('Label', s, 'label'),
          h('div', { class: 'row', style: 'align-items:end' }, h('div', { style: 'flex:1' }, text('Link', s, 'url', { placeholder: 'https://...' })), rowButtons(c.socials, i, paintSoc))));
      });
    }
    paintSoc();
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Social and profile links' }), h('p', { class: 'hint', text: 'Links left empty are not shown on the website.' }), soc,
      h('button', { class: 'btn', type: 'button', text: 'Add a link', onclick: function () { c.socials.push({ label: '', url: '' }); dirty(); paintSoc(); } })));
  }

  function tabAbout(p, c) {
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'About section' }),
      text('Heading', c.about, 'heading'),
      listText('Text', c.about, 'paragraphs', { lines: true, rows: 9, hint: 'Leave a blank line between paragraphs.' })));
    var box = h('div', {});
    function paint() {
      clear(box);
      c.about.highlights.forEach(function (x, i) {
        box.appendChild(h('div', { class: 'grid2', style: 'align-items:end' }, text('Value', x, 'value'),
          h('div', { class: 'row', style: 'align-items:end' }, h('div', { style: 'flex:1' }, text('Label', x, 'label')), rowButtons(c.about.highlights, i, paint))));
      });
    }
    paint();
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Quick facts' }), h('p', { class: 'hint', text: 'Small facts shown next to your about text. Up to 6.' }), box,
      h('button', { class: 'btn', type: 'button', text: 'Add a fact', onclick: function () { if (c.about.highlights.length < 6) { c.about.highlights.push({ label: '', value: '' }); dirty(); paint(); } } })));
  }

  function tabSkills(p, c) {
    var box = h('div', {});
    function paint() {
      clear(box);
      c.skills.forEach(function (g, i) {
        box.appendChild(h('details', { class: 'item', open: !g.group },
          h('summary', {}, h('span', { text: g.group || 'New skill group' }), h('span', { class: 'sp' }), rowButtons(c.skills, i, paint)),
          h('div', { class: 'item-body' }, text('Group name', g, 'group'), listText('Skills', g, 'items', { hint: 'Separate skills with commas.', area: true, rows: 3 }))));
      });
    }
    paint();
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Skills and tools' }), h('p', { class: 'hint', text: 'Group your skills by theme.' }), box,
      h('button', { class: 'btn', type: 'button', text: 'Add a group', onclick: function () { c.skills.push({ group: '', items: [] }); dirty(); paint(); } })));
  }

  function tabProjects(p, c) {
    var box = h('div', {});
    function paint() {
      clear(box);
      c.projects.forEach(function (pr, i) {
        box.appendChild(h('details', { class: 'item' },
          h('summary', {}, h('span', { text: pr.title || 'Untitled project' }), pr.featured && h('span', { class: 'tag', text: 'Featured' }), h('small', { text: pr.category }), h('span', { class: 'sp' }), rowButtons(c.projects, i, paint)),
          h('div', { class: 'item-body' },
            h('div', { class: 'grid2' }, text('Title', pr, 'title'), text('Category', pr, 'category', { hint: 'Used for the filter buttons, for example "Web development".' })),
            text('Short summary', pr, 'summary', { area: true, rows: 2, hint: 'Shown on the project card.' }),
            text('Full description', pr, 'description', { area: true, rows: 9, hint: 'Shown when a visitor opens the project. Leave a blank line between paragraphs.' }),
            text('Your role', pr, 'role'),
            listText('Technologies', pr, 'tags', { hint: 'Separate with commas.' }),
            imageField('Project image', pr, 'image', 'A wide image (16:9) works best. Without one, a coloured placeholder is used.'),
            h('div', { class: 'grid2' }, text('Project link', pr, 'link', { placeholder: 'https://...', hint: 'Optional: live site, repository or dashboard.' }), text('Link button text', pr, 'linkLabel')),
            (function () {
              var cb = h('input', { type: 'checkbox' });
              cb.checked = !!pr.featured;
              cb.addEventListener('change', function () { pr.featured = cb.checked; dirty(); paint(); });
              return h('label', { class: 'checks' }, cb, document.createTextNode('Featured (shown larger)'));
            })())));
      });
    }
    paint();
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Projects' }), h('p', { class: 'hint', text: 'Use the Up and Down buttons to change the order shown on the website.' }), box,
      h('button', { class: 'btn primary', type: 'button', text: 'Add a project', onclick: function () {
        c.projects.unshift({ id: 'p' + Date.now().toString(36), title: 'New project', category: '', summary: '', description: '', role: '', tags: [], image: '', link: '', linkLabel: 'View project', featured: false });
        dirty(); paint(); box.querySelector('details').open = true;
      } })));
  }

  function tabJourney(p, c) {
    var box = h('div', {});
    function paint() {
      clear(box);
      c.journey.forEach(function (j, i) {
        box.appendChild(h('details', { class: 'item', open: !j.title },
          h('summary', {}, h('span', { text: j.title || 'New entry' }), h('small', { text: j.period }), h('span', { class: 'sp' }), rowButtons(c.journey, i, paint)),
          h('div', { class: 'item-body' },
            h('div', { class: 'grid2' }, text('Title', j, 'title'), text('Period', j, 'period', { placeholder: 'For example 2026 or Now' })),
            text('Place', j, 'place'), text('Description', j, 'description', { area: true, rows: 3 }))));
      });
    }
    paint();
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Learning journey' }), h('p', { class: 'hint', text: 'Education, courses and milestones, shown as a timeline.' }), box,
      h('button', { class: 'btn', type: 'button', text: 'Add an entry', onclick: function () { c.journey.push({ period: '', title: '', place: '', description: '' }); dirty(); paint(); } })));
  }

  function tabMessages(p) {
    var box = h('div', {});
    p.appendChild(box);
    function load() {
      api('GET', '/api/admin/messages').then(function (list) {
        state.unread = list.filter(function (m) { return !m.read; }).length;
        paintNav();
        clear(box);
        if (!list.length) box.appendChild(h('div', { class: 'card' }, h('p', { class: 'hint', text: 'No messages yet. Messages sent from your contact form appear here.' })));
        list.forEach(function (m) {
          box.appendChild(h('div', { class: 'msg' + (m.read ? '' : ' unread') },
            h('header', {}, h('strong', { text: m.name }), h('span', { class: 'hint', text: new Date(m.date).toLocaleString() })),
            h('p', { text: m.message }),
            h('div', { class: 'row' },
              h('a', { class: 'btn sm', href: 'mailto:' + m.email, text: 'Reply to ' + m.email }),
              h('button', { class: 'btn sm', type: 'button', text: m.read ? 'Mark as unread' : 'Mark as read', onclick: function () { api('PATCH', '/api/admin/messages/' + m.id, { read: !m.read }).then(load); } }),
              h('button', { class: 'btn sm danger', type: 'button', text: 'Delete', onclick: function () { if (confirm('Delete this message?')) api('DELETE', '/api/admin/messages/' + m.id).then(load); } }))));
        });
      }).catch(function (e) { toast(e.message, true); });
    }
    load();
  }

  function tabMedia(p) {
    var box = h('div', { class: 'media-grid' });
    var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
    function load() {
      api('GET', '/api/admin/uploads').then(function (files) {
        clear(box);
        if (!files.length) box.appendChild(h('p', { class: 'hint', text: 'No images uploaded yet.' }));
        files.forEach(function (f) {
          box.appendChild(h('div', { class: 'media-item' }, h('img', { src: f.url, alt: '' }),
            h('div', { class: 'row' },
              h('button', { class: 'btn sm', type: 'button', text: 'Copy link', onclick: function () { navigator.clipboard && navigator.clipboard.writeText(location.origin + f.url).then(function () { toast('Link copied.'); }); } }),
              h('button', { class: 'btn sm danger', type: 'button', text: 'Delete', onclick: function () {
                if (confirm('Delete this image? Any page still using it will show a placeholder.')) api('DELETE', '/api/admin/uploads/' + encodeURIComponent(f.name)).then(load);
              } }))));
        });
      }).catch(function (e) { toast(e.message, true); });
    }
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      var fd = new FormData(); fd.append('image', file.files[0]);
      api('POST', '/api/admin/upload', fd).then(function () { toast('Image uploaded.'); load(); }).catch(function (e) { toast(e.message, true); });
      file.value = '';
    });
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Uploaded images' }),
      h('p', { class: 'hint', text: 'JPG, PNG, WebP or GIF, up to 6 MB. To use an image, open a project or the General tab and choose it from the library.' }),
      h('div', { class: 'row', style: 'margin-bottom:16px' }, h('button', { class: 'btn primary', type: 'button', text: 'Upload image', onclick: function () { file.click(); } }), file), box));
    load();
  }

  function tabSecurity(p) {
    var cur = h('input', { type: 'password', autocomplete: 'current-password' });
    var nw = h('input', { type: 'password', autocomplete: 'new-password' });
    var nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    var err = h('p', { class: 'err-text' });
    p.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Change admin password' }), h('p', { class: 'hint', text: 'Use at least 10 characters.' }),
      field('Current password', cur), field('New password', nw), field('Repeat new password', nw2), err,
      h('button', { class: 'btn primary', type: 'button', text: 'Update password', onclick: function () {
        err.textContent = '';
        if (nw.value !== nw2.value) { err.textContent = 'The new passwords do not match.'; return; }
        api('POST', '/api/admin/password', { current: cur.value, next: nw.value }).then(function () {
          state.isDefault = false; cur.value = nw.value = nw2.value = ''; toast('Password updated.'); render();
        }).catch(function (e) { err.textContent = e.message; });
      } })));
  }

  /* ---------- layout ---------- */
  function paintNav() {
    var nav = document.getElementById('sideNav');
    if (!nav) return;
    clear(nav);
    TABS.forEach(function (t) {
      nav.appendChild(h('button', { type: 'button', class: state.tab === t[0] ? 'on' : '', onclick: function () { state.tab = t[0]; render(); } },
        h('span', { text: t[1] }), t[0] === 'messages' && state.unread > 0 && h('span', { class: 'badge', text: String(state.unread) })));
    });
  }

  function save() {
    if (state.saving) return;
    state.saving = true;
    var b = document.getElementById('saveBtn');
    if (b) b.disabled = true;
    api('PUT', '/api/admin/content', state.content).then(function (clean) {
      state.content = clean; state.dirty = false; toast('Changes saved. Your website is updated.');
      var s = document.getElementById('saveState');
      if (s) { s.textContent = 'All changes saved'; s.className = 'state'; }
    }).catch(function (e) { toast(e.message, true); if (b) b.disabled = false; })
      .then(function () { state.saving = false; });
  }

  function render() {
    clear(app);
    var c = state.content;
    var panel = h('div', {});
    var titles = {}; TABS.forEach(function (t) { titles[t[0]] = t[1]; });
    var side = h('aside', { class: 'side' }, h('h2', { text: 'Portfolio admin' }), h('div', { id: 'sideNav', style: 'display:contents' }), h('span', { class: 'grow' }),
      h('a', { href: '/', target: '_blank', rel: 'noopener', text: 'View website' }),
      h('button', { type: 'button', text: 'Log out', onclick: function () {
        if (state.dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
        state.dirty = false; api('POST', '/api/admin/logout').then(showLogin);
      } }));
    var isContentTab = ['messages', 'media', 'security'].indexOf(state.tab) < 0;
    var bar = h('div', { class: 'bar' }, h('h1', { text: titles[state.tab] }),
      isContentTab && h('div', { class: 'row' },
        h('span', { id: 'saveState', class: 'state' + (state.dirty ? ' dirty' : ''), text: state.dirty ? 'Unsaved changes' : 'All changes saved' }),
        h('button', { id: 'saveBtn', class: 'btn primary', type: 'button', text: 'Save changes', disabled: !state.dirty, onclick: save })));
    var main = h('main', { class: 'main' }, bar);
    if (state.isDefault) main.appendChild(h('div', { class: 'banner', text: 'You are still using the default password. Please change it in the Security tab.' }));
    main.appendChild(panel);
    app.appendChild(h('div', { class: 'shell' }, side, main));
    paintNav();
    var fn = { general: tabGeneral, about: tabAbout, skills: tabSkills, projects: tabProjects, journey: tabJourney, messages: tabMessages, media: tabMedia, security: tabSecurity }[state.tab];
    fn(panel, c);
  }

  function showLogin() {
    clear(app);
    var pw = h('input', { type: 'password', autocomplete: 'current-password', autofocus: true });
    var err = h('p', { class: 'err-text' });
    function go(e) {
      e.preventDefault();
      err.textContent = '';
      api('POST', '/api/admin/login', { password: pw.value }).then(function (r) { state.isDefault = r.isDefault; boot(); })
        .catch(function (e2) { err.textContent = e2.message; });
    }
    app.appendChild(h('div', { class: 'login' }, h('form', { class: 'login-card', onsubmit: go },
      h('h1', { text: 'Admin portal' }), h('p', { text: 'Log in to edit your portfolio.' }),
      field('Password', pw), err, h('button', { class: 'btn primary', type: 'submit', text: 'Log in' }))));
    pw.focus();
  }

  function boot() {
    api('GET', '/api/admin/content').then(function (c) {
      state.content = c; state.dirty = false;
      return api('GET', '/api/admin/messages');
    }).then(function (m) {
      state.unread = m.filter(function (x) { return !x.read; }).length;
      render();
    }).catch(function () { /* login screen already shown on 401 */ });
  }

  api('GET', '/api/admin/me').then(function (me) {
    if (me.authenticated) { state.isDefault = me.isDefault; boot(); } else showLogin();
  }).catch(showLogin);
})();
