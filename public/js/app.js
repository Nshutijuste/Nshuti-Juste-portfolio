(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var content = null;
  var activeFilter = 'All';

  /* tiny element builder: everything is inserted as text, never as HTML */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
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
  function initials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (t) { return h('p', { text: t.trim() }); });
  }

  /* theme */
  var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  function paintThemeBtn() {
    var dark = document.documentElement.dataset.theme === 'dark';
    var btn = $('themeBtn');
    clear(btn);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = dark ? SUN : MOON; // static markup defined above, no user content
    btn.appendChild(svg);
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  $('themeBtn').addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
    paintThemeBtn();
  });
  paintThemeBtn();

  /* mobile menu */
  $('menuBtn').addEventListener('click', function () {
    var open = $('nav').classList.toggle('open');
    this.setAttribute('aria-expanded', open);
  });
  $('nav').addEventListener('click', function (e) {
    if (e.target.tagName === 'A') { $('nav').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); }
  });

  var backTop = $('backTop');
  function goToTop(e) {
    if (e) e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    history.replaceState(null, '', '#top');
  }
  document.querySelectorAll('a[href="#top"]').forEach(function (link) { link.addEventListener('click', goToTop); });
  backTop.addEventListener('click', goToTop);
  window.addEventListener('scroll', function () { backTop.hidden = window.scrollY < 400; }, { passive: true });

  /* render */
  function renderSite(c) {
    var s = c.site;
    document.title = s.name + (s.role ? ' | ' + s.role : '');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', s.metaDescription || s.tagline);
    document.documentElement.style.setProperty('--accent', s.accent);
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', s.accent);

    var brand = $('brand');
    clear(brand);
    brand.appendChild(h('span', { class: 'brand-mark', text: initials(s.name)[0] }));
    brand.appendChild(h('span', { text: s.name }));

    $('heroRole').textContent = s.role;
    $('heroName').textContent = s.name;
    $('heroTag').textContent = s.tagline;
    var av = $('heroAvail');
    av.hidden = !s.availability;
    av.textContent = s.availability;
    var cv = $('heroCv');
    cv.hidden = !s.resumeUrl;
    if (s.resumeUrl) cv.href = s.resumeUrl;

    var photo = $('heroPhoto');
    clear(photo);
    if (s.profileImage) photo.appendChild(h('img', { src: s.profileImage, alt: 'Portrait of ' + s.name, width: 640, height: 800 }));
    else photo.appendChild(h('div', { class: 'initials', text: initials(s.name) }));
    if (s.location) photo.appendChild(h('span', { class: 'place', text: s.location }));

    $('footText').textContent = '\u00A9 ' + new Date().getFullYear() + ' ' + (s.footerText || s.name);
  }

  function renderAbout(c) {
    $('aboutH').textContent = c.about.heading;
    var box = $('aboutText');
    clear(box);
    c.about.paragraphs.forEach(function (p) { box.appendChild(h('p', { text: p })); });
    var facts = $('facts');
    clear(facts);
    facts.hidden = !c.about.highlights.length;
    c.about.highlights.forEach(function (f) {
      facts.appendChild(h('li', {}, h('b', { text: f.value }), h('span', { text: f.label })));
    });
  }

  function renderSkills(c) {
    var g = $('skillGrid');
    clear(g);
    c.skills.forEach(function (grp) {
      var ul = h('ul', { class: 'chips' });
      grp.items.forEach(function (i) { ul.appendChild(h('li', { text: i })); });
      g.appendChild(h('div', { class: 'skill' }, h('h3', { text: grp.group }), ul));
    });
  }

  function gradientFor(i) {
    var angle = 120 + (i * 37) % 120;
    return 'linear-gradient(' + angle + 'deg, color-mix(in srgb, var(--accent) 85%, #fff), color-mix(in srgb, var(--accent) 60%, #000))';
  }

  function media(p, i) {
    if (p.image) return h('img', { src: p.image, alt: p.title, loading: 'lazy' });
    var ph = h('div', { class: 'ph', text: initials(p.title), 'aria-hidden': 'true' });
    ph.style.background = gradientFor(i);
    return ph;
  }

  function renderFilters(c) {
    var cats = ['All'];
    c.projects.forEach(function (p) { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
    var box = $('filters');
    clear(box);
    box.hidden = cats.length < 3;
    cats.forEach(function (cat) {
      box.appendChild(h('button', {
        type: 'button', text: cat, 'aria-pressed': String(cat === activeFilter),
        onclick: function () { activeFilter = cat; renderFilters(c); renderProjects(c); },
      }));
    });
  }

  function renderProjects(c) {
    var grid = $('projGrid');
    clear(grid);
    var shown = c.projects.map(function (p, i) { return { p: p, i: i }; })
      .filter(function (x) { return activeFilter === 'All' || x.p.category === activeFilter; });
    if (!shown.length) grid.appendChild(h('p', { class: 'empty', text: 'No projects to show yet.' }));
    shown.forEach(function (x, pos) {
      var p = x.p;
      var tags = h('ul', { class: 'chips' });
      p.tags.slice(0, 4).forEach(function (t) { tags.appendChild(h('li', { text: t })); });
      var feat = p.featured && activeFilter === 'All';
      var card = h('button', {
        type: 'button', class: 'proj' + (feat ? ' featured' : ''), 'aria-haspopup': 'dialog',
        onclick: function () { openProject(p, x.i); },
      },
        h('div', { class: 'proj-media' }, media(p, x.i)),
        h('div', { class: 'proj-body' },
          p.category && h('span', { class: 'proj-cat', text: p.category }),
          h('h3', { text: p.title }),
          h('p', { class: 'proj-sum', text: p.summary }),
          tags,
          h('span', { class: 'more', text: 'Read details' })
        )
      );
      if (pos === 0 && feat) card.classList.add('featured');
      grid.appendChild(card);
    });
  }

  var modal = $('projModal');
  function openProject(p, i) {
    var body = $('modalBody');
    clear(body);
    var tags = h('ul', { class: 'chips' });
    p.tags.forEach(function (t) { tags.appendChild(h('li', { text: t })); });
    var actions = h('div', { class: 'modal-actions' });
    if (p.link) actions.appendChild(h('a', { class: 'btn primary', href: p.link, target: '_blank', rel: 'noopener noreferrer', text: p.linkLabel || 'View project' }));
    actions.appendChild(h('button', { class: 'btn', type: 'button', text: 'Close', onclick: function () { modal.close(); } }));
    body.appendChild(h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '\u2715', onclick: function () { modal.close(); } }));
    body.appendChild(h('div', { class: 'modal-media' }, media(p, i)));
    var text = h('div', { class: 'modal-text' },
      p.category && h('span', { class: 'proj-cat', text: p.category }),
      h('h3', { id: 'mTitle', text: p.title }),
      p.role && h('p', { class: 'role', text: 'My role: ' + p.role })
    );
    paragraphs(p.description || p.summary).forEach(function (el) { text.appendChild(el); });
    text.appendChild(tags);
    text.appendChild(actions);
    body.appendChild(text);
    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
  }
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.close(); });

  function renderJourney(c) {
    var ol = $('timeline');
    clear(ol);
    c.journey.forEach(function (j) {
      ol.appendChild(h('li', {},
        j.period && h('div', { class: 't-period', text: j.period }),
        h('h3', { text: j.title }),
        j.place && h('div', { class: 't-place', text: j.place }),
        j.description && h('p', { text: j.description })
      ));
    });
    $('journey').hidden = !c.journey.length;
  }

  function renderContact(c) {
    var ul = $('contactList');
    clear(ul);
    var s = c.site;
    if (s.email) ul.appendChild(h('li', {}, h('a', { href: 'mailto:' + s.email, text: s.email })));
    if (s.location) ul.appendChild(h('li', {}, h('span', { text: s.location })));
    c.socials.forEach(function (x) {
      if (x.url) ul.appendChild(h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', text: x.label })));
    });
  }

  function renderAll(c) {
    content = c;
    renderSite(c); renderAbout(c); renderSkills(c); renderFilters(c); renderProjects(c); renderJourney(c); renderContact(c);
  }

  fetch('/api/content').then(function (r) { return r.json(); }).then(renderAll).catch(function () {
    $('heroName').textContent = 'Content could not be loaded';
    $('heroTag').textContent = 'Please refresh the page or try again later.';
  });

  /* contact form */
  var form = $('contactForm');
  var note = $('formNote');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('sendBtn');
    note.className = 'form-note';
    note.textContent = '';
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.name.trim() || !data.message.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      note.className = 'form-note err';
      note.textContent = 'Please fill in your name, a valid email and a message.';
      return;
    }
    btn.disabled = true;
    fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || 'Could not send your message.');
        form.reset();
        note.className = 'form-note ok';
        note.textContent = 'Thank you. Your message has been sent.';
      })
      .catch(function (err) { note.className = 'form-note err'; note.textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });
})();
