// ============================================================
// STAYHERE POINTAGE — Application principale
// ============================================================

const POSTES = [
  'Kindness Ambassador',
  'Kindness Host',
  'Femme de chambre',
  'Technicien',
  'Valet',
  'Coursier',
  'Jardinier',
  'Réceptionniste',
  'Manager de site',
];

const TYPES = [
  { key: 'travaille', label: 'Présent',            short: '1',   code: '1'   },
  { key: 'off',       label: 'Off / Repos',        short: 'OFF', code: 'OFF' },
  { key: 'maladie',   label: 'Maladie',            short: 'M',   code: 'M'   },
  { key: 'conge',     label: 'Congé',              short: 'C',   code: 'C'   },
  { key: 'recup',     label: 'Récupération',       short: 'R',   code: 'R'   },
  { key: 'depart',    label: 'Départ',             short: 'D',   code: 'D'   },
  { key: 'absence',   label: 'Absent',             short: 'A',   code: 'A'   },
  { key: 'at',        label: 'Accident Travail',   short: 'AT',  code: 'AT'  },
  { key: 'ferie',     label: 'Férié',              short: 'F',   code: 'F'   },
  { key: 'aj',        label: 'Absence Justifiée',  short: 'AJ',  code: 'AJ'  },
  { key: 'nvrecru',   label: 'Nouveau Recruté',    short: 'NR',  code: 'NV RECRU' },
  { key: 'standby',   label: 'Stand By',           short: 'SB',  code: 'STAND BY' },
];

const ROLES = {
  cluster_ops: 'Cluster Ops Manager',
  juriste: 'Juriste',
  responsable_financier: 'Responsable Financier',
  kindness_ambassador: 'Kindness Ambassador',
};

// ---- Utilitaires Date ----
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getDayOfWeek(year, month, day) {
  return new Date(year, month, day).getDay(); // 0=dim, 6=sam
}

function isWeekend(year, month, day) {
  const d = getDayOfWeek(year, month, day);
  return d === 0 || d === 6;
}

function formatDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatMonthLabel(year, month) {
  const names = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${names[month]} ${year}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ---- Application ----
const App = {
  session: null,
  currentPage: 'pointage',
  currentSite: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),

  init() {
    DB.init();
    this.session = DB.getSession();
    if (this.session && this.session.id) {
      this.showApp();
    } else {
      this.showLogin();
    }
  },

  // ---- PERMISSIONS ----
  canSeeGlobal() {
    return ['cluster_ops', 'juriste', 'responsable_financier'].includes(this.session?.role);
  },
  canValidate() {
    return ['cluster_ops', 'juriste', 'responsable_financier'].includes(this.session?.role);
  },
  canManage() {
    return ['cluster_ops', 'juriste', 'responsable_financier'].includes(this.session?.role);
  },
  canLock() {
    return ['cluster_ops'].includes(this.session?.role);
  },
  canEnter() {
    return true; // tous peuvent saisir leur site
  },

  // ---- LOGIN ----
  showLogin() {
    document.body.innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="login-logo">
            <h1><span class="logo-circle">●</span> StayHere <span class="logo-triangle">▲</span></h1>
            <p>Système de Pointage — Gestion RH</p>
          </div>
          <div id="login-error" class="alert alert-danger hidden"></div>
          <form id="login-form">
            <div class="form-group">
              <label>Identifiant</label>
              <input type="text" id="username" placeholder="Votre identifiant" autocomplete="username" required>
            </div>
            <div class="form-group">
              <label>Mot de passe</label>
              <input type="password" id="password" placeholder="••••••••" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn btn-primary w-full" style="justify-content:center;margin-top:8px">
              Se connecter
            </button>
          </form>
        </div>
      </div>`;

    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const user = DB.getUserByCredentials(username, password);
      if (user) {
        DB.setSession(user);
        this.session = user;
        this.showApp();
      } else {
        const err = document.getElementById('login-error');
        err.textContent = 'Identifiant ou mot de passe incorrect.';
        err.classList.remove('hidden');
      }
    });
  },

  // ---- APP SHELL ----
  showApp() {
    const isKA = this.session.role === 'kindness_ambassador';
    if (isKA && this.session.site) {
      this.currentSite = this.session.site;
    } else if (!this.currentSite) {
      this.currentSite = DB.getSites()[0]?.id || null;
    }

    document.body.innerHTML = `
      <div id="app">
        <aside class="sidebar">
          <div class="sidebar-logo">
            <h2><span class="logo-circle">●</span> StayHere <span class="logo-triangle">▲</span></h2>
            <p>Gestion du Pointage</p>
          </div>
          <div class="sidebar-user">
            <div class="user-name">${this.session.nom}</div>
            <div class="user-role">${ROLES[this.session.role] || this.session.role}</div>
          </div>
          <nav>
            <div class="nav-section">Pointage</div>
            <div class="nav-item ${this.currentPage === 'pointage' ? 'active' : ''}" onclick="App.navigate('pointage')">
              <span class="icon">📅</span> Saisie du pointage
            </div>
            ${this.canSeeGlobal() ? `
            <div class="nav-item ${this.currentPage === 'synthese' ? 'active' : ''}" onclick="App.navigate('synthese')">
              <span class="icon">📊</span> Synthèse globale
            </div>` : ''}
            ${this.canValidate() ? `
            <div class="nav-item ${this.currentPage === 'validation' ? 'active' : ''}" onclick="App.navigate('validation')">
              <span class="icon">✅</span> Validation
            </div>` : ''}
            ${this.canManage() ? `
            <div class="nav-section">Administration</div>
            <div class="nav-item ${this.currentPage === 'collaborateurs' ? 'active' : ''}" onclick="App.navigate('collaborateurs')">
              <span class="icon">👥</span> Collaborateurs
            </div>
            <div class="nav-item ${this.currentPage === 'sites' ? 'active' : ''}" onclick="App.navigate('sites')">
              <span class="icon">🏠</span> Sites
            </div>
            <div class="nav-item ${this.currentPage === 'feries' ? 'active' : ''}" onclick="App.navigate('feries')">
              <span class="icon">🎌</span> Jours fériés
            </div>
            <div class="nav-item ${this.currentPage === 'utilisateurs' ? 'active' : ''}" onclick="App.navigate('utilisateurs')">
              <span class="icon">🔐</span> Utilisateurs
            </div>
            <div class="nav-section">Contrôle</div>
            <div class="nav-item ${this.currentPage === 'audit' ? 'active' : ''}" onclick="App.navigate('audit')">
              <span class="icon">📋</span> Historique
            </div>` : ''}
            ${this.canLock() ? `
            <div class="nav-item ${this.currentPage === 'verrous' ? 'active' : ''}" onclick="App.navigate('verrous')">
              <span class="icon">🔒</span> Verrous
            </div>` : ''}
          </nav>
          <div class="sidebar-footer">
            <button class="btn-logout" onclick="App.logout()">⬅ Déconnexion</button>
          </div>
        </aside>
        <main class="main-content">
          <div class="topbar">
            <h2 id="page-title">Pointage</h2>
            <div class="topbar-actions" id="topbar-actions"></div>
          </div>
          <div class="page" id="page-content"></div>
        </main>
      </div>`;

    this.renderPage();
  },

  navigate(page) {
    this.currentPage = page;
    // Mettre à jour nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    event?.target?.closest('.nav-item')?.classList.add('active');
    this.renderPage();
  },

  renderPage() {
    const titles = {
      pointage: 'Saisie du pointage',
      synthese: 'Synthèse globale',
      validation: 'Validation',
      collaborateurs: 'Collaborateurs',
      sites: 'Sites',
      feries: 'Jours fériés',
      utilisateurs: 'Utilisateurs',
      audit: 'Historique des modifications',
      verrous: 'Verrous de période',
    };
    document.getElementById('page-title').textContent = titles[this.currentPage] || '';
    document.getElementById('topbar-actions').innerHTML = '';

    const pages = {
      pointage: () => this.renderPointage(),
      synthese: () => this.renderSynthese(),
      validation: () => this.renderValidation(),
      collaborateurs: () => this.renderCollaborateurs(),
      sites: () => this.renderSites(),
      feries: () => this.renderFeries(),
      utilisateurs: () => this.renderUtilisateurs(),
      audit: () => this.renderAudit(),
      verrous: () => this.renderVerrous(),
    };

    (pages[this.currentPage] || (() => {}))();
  },

  // ---- PAGE POINTAGE ----
  renderPointage() {
    const sites = DB.getSites().filter(s => s.actif);
    const isKA = this.session.role === 'kindness_ambassador';
    const site = DB.getSiteById(this.currentSite);
    const lock = DB.getLock(this.currentSite, `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}`);
    const employees = DB.getEmployees(this.currentSite).filter(e => e.actif);
    const daysInMonth = getDaysInMonth(this.currentYear, this.currentMonth);
    const yearMonth = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}`;
    const pointageEntries = DB.getPointage(this.currentSite, this.currentYear, this.currentMonth + 1);

    // Topbar actions
    if (this.canSeeGlobal()) {
      document.getElementById('topbar-actions').innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="App.exportCSV()">⬇ Export CSV</button>`;
    }

    let siteSelector = '';
    if (!isKA) {
      siteSelector = `
        <select onchange="App.changeSite(this.value)" style="max-width:220px">
          ${sites.map(s => `<option value="${s.id}" ${s.id === this.currentSite ? 'selected' : ''}>${s.nom}</option>`).join('')}
        </select>`;
    } else {
      siteSelector = `<strong style="color:var(--text-muted)">${site?.nom || ''}</strong>`;
    }

    const legendHtml = TYPES.map(t => `
      <div class="legend-item">
        <div class="legend-dot" style="background:var(--${t.key}-bg);border:1px solid var(--${t.key})"></div>
        <span>${t.label} (${t.short})</span>
      </div>`).join('');

    // Construire le header des jours
    let daysHeader = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDateStr(this.currentYear, this.currentMonth, d);
      const wd = getDayOfWeek(this.currentYear, this.currentMonth, d);
      const isWE = wd === 0 || wd === 6;
      const isFerie = DB.isHoliday(dateStr);
      const dayNames = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
      const cls = isFerie ? 'day-ferie' : isWE ? 'day-weekend' : '';
      daysHeader += `<th class="${cls}" title="${isFerie ? DB.getHolidayName(dateStr) : ''}">${dayNames[wd]}<br>${d}</th>`;
    }

    // Lignes employés
    let rows = '';
    employees.forEach(emp => {
      let cells = '';
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = formatDateStr(this.currentYear, this.currentMonth, d);
        const wd = getDayOfWeek(this.currentYear, this.currentMonth, d);
        const isWE = wd === 0 || wd === 6;
        const isFerie = DB.isHoliday(dateStr);
        const entry = pointageEntries.find(p => p.employee_id === emp.id && p.date === dateStr);
        const isLocked = !!lock;

        if (isWE && !entry) {
          cells += `<td><button class="cell-btn weekend" disabled title="Week-end">—</button></td>`;
        } else if (entry) {
          const type = TYPES.find(t => t.key === entry.type);
          const validMark = entry.validated ? ' ✓' : '';
          const lockedCls = isLocked ? ' locked' : '';
          const clickHandler = isLocked ? '' : `onclick="App.openSaisie('${emp.id}','${dateStr}')"`;
          cells += `<td class="has-entry"><button class="cell-btn ${entry.type}${lockedCls}" ${clickHandler} title="${type?.label || entry.type}${entry.notes ? ' — ' + entry.notes : ''}${validMark ? ' (validé)' : ''}">${type?.short || entry.type}${validMark}</button></td>`;
        } else {
          const lockedCls = isLocked ? ' locked' : '';
          const clickHandler = isLocked ? '' : `onclick="App.openSaisie('${emp.id}','${dateStr}')"`;
          const ferieLabel = isFerie ? 'F' : '+';
          const ferieType = isFerie ? ' ferie' : '';
          if (isFerie) {
            cells += `<td><button class="cell-btn ferie${lockedCls}" ${clickHandler} title="${DB.getHolidayName(dateStr)}">${ferieLabel}</button></td>`;
          } else {
            cells += `<td><button class="cell-btn${lockedCls}" style="color:#ccc;font-size:16px" ${clickHandler}>·</button></td>`;
          }
        }
      }

      rows += `
        <tr>
          <td class="col-emp">
            <div class="emp-name">${emp.prenom} ${emp.nom}</div>
            <div class="emp-poste">${emp.poste}${emp.affectation ? ' · ' + emp.affectation : ''}</div>
          </td>
          ${cells}
        </tr>`;
    });

    document.getElementById('page-content').innerHTML = `
      <div class="grid-controls">
        ${siteSelector}
        <div class="month-nav">
          <button onclick="App.prevMonth()">‹</button>
          <span>${formatMonthLabel(this.currentYear, this.currentMonth)}</span>
          <button onclick="App.nextMonth()">›</button>
        </div>
        ${lock ? `<div class="lock-indicator">🔒 Période verrouillée par ${lock.locked_by}</div>` : ''}
      </div>
      <div class="legend">${legendHtml}</div>
      ${employees.length === 0 ? `<div class="alert alert-warning">Aucun collaborateur actif sur ce site.</div>` : ''}
      <div class="pointage-table-wrapper">
        <table class="pointage-table">
          <thead>
            <tr>
              <th class="col-emp">Collaborateur</th>
              ${daysHeader}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  openSaisie(empId, date) {
    const emp = DB.getEmployees().find(e => e.id === empId);
    if (!emp) return;
    const existing = DB.getPointageByEmployeeDate(empId, date);
    const [y, m, d] = date.split('-');
    const dateLabel = `${d}/${m}/${y}`;

    const typeBtns = TYPES.map(t => `
      <button class="type-btn ${t.key} ${existing?.type === t.key ? 'selected' : ''}"
        onclick="App.selectType(this, '${t.key}')">${t.label}</button>`).join('');

    const deleteBtn = existing ? `<button class="btn btn-danger btn-sm" onclick="App.deletePointage('${empId}','${date}')">Supprimer</button>` : '';

    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Pointage — ${emp.prenom} ${emp.nom}</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <p class="text-muted text-sm mb-16">📅 ${dateLabel} &nbsp;·&nbsp; ${emp.poste}</p>
      <div id="saisie-error" class="alert alert-danger hidden"></div>
      <div class="type-grid">${typeBtns}</div>
      <div class="form-group">
        <label>Notes (optionnel)</label>
        <textarea id="saisie-notes" rows="2" placeholder="Observation...">${existing?.notes || ''}</textarea>
      </div>
      <div class="modal-actions">
        ${deleteBtn}
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveSaisie('${empId}','${date}')">Enregistrer</button>
      </div>
    `);
    this._saisieType = existing?.type || null;
  },

  selectType(btn, type) {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    this._saisieType = type;
  },

  saveSaisie(empId, date) {
    if (!this._saisieType) {
      const err = document.getElementById('saisie-error');
      err.textContent = 'Veuillez sélectionner un type.';
      err.classList.remove('hidden');
      return;
    }
    const notes = document.getElementById('saisie-notes')?.value || '';
    try {
      DB.setPointage(empId, date, this._saisieType, notes, this.session);
      this.closeModal();
      this.renderPointage();
    } catch (e) {
      const err = document.getElementById('saisie-error');
      err.textContent = e.message;
      err.classList.remove('hidden');
    }
  },

  deletePointage(empId, date) {
    if (!confirm('Supprimer cette entrée de pointage ?')) return;
    try {
      DB.deletePointage(empId, date, this.session);
      this.closeModal();
      this.renderPointage();
    } catch (e) {
      alert(e.message);
    }
  },

  prevMonth() {
    if (this.currentMonth === 0) { this.currentMonth = 11; this.currentYear--; }
    else { this.currentMonth--; }
    this.renderPointage();
  },
  nextMonth() {
    if (this.currentMonth === 11) { this.currentMonth = 0; this.currentYear++; }
    else { this.currentMonth++; }
    this.renderPointage();
  },
  changeSite(siteId) {
    this.currentSite = siteId;
    this.renderPointage();
  },

  exportCSV() {
    const csv = DB.exportCSV(this.currentSite, this.currentYear, this.currentMonth + 1);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pointage_${this.currentSite}_${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}.csv`;
    a.click();
  },

  // ---- SYNTHÈSE ----
  renderSynthese() {
    const sites = DB.getSites().filter(s => s.actif);

    const siteOptions = sites.map(s => `<option value="${s.id}" ${s.id === this.currentSite ? 'selected' : ''}>${s.nom}</option>`).join('');

    let synthHtml = '';
    sites.forEach(site => {
      const synth = DB.getSynthese(site.id, this.currentYear, this.currentMonth + 1);
      const emps = Object.values(synth);
      if (emps.length === 0) return;

      const totals = {};
      TYPES.forEach(t => { totals[t.key] = emps.reduce((s, e) => s + (e.totals[t.key] || 0), 0); });

      synthHtml += `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🏠 ${site.nom}</div>
            <button class="btn btn-ghost btn-sm" onclick="App.exportSiteCSV('${site.id}')">⬇ Export</button>
          </div>
          <div class="table-wrapper">
            <table class="synth-table">
              <thead>
                <tr>
                  <th>Collaborateur</th>
                  <th>Poste</th>
                  ${TYPES.map(t => `<th style="color:var(--${t.key}-bg);background:var(--${t.key})">${t.label}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${emps.map(({ emp, totals: t }) => `
                  <tr>
                    <td>${emp.prenom} ${emp.nom}</td>
                    <td><span class="text-muted text-sm">${emp.poste}</span></td>
                    ${TYPES.map(type => `<td class="num" style="color:var(--${type.key})">${t[type.key] || 0}</td>`).join('')}
                  </tr>`).join('')}
                <tr style="font-weight:700;background:var(--bg)">
                  <td colspan="2">TOTAL SITE</td>
                  ${TYPES.map(type => `<td class="num">${totals[type.key]}</td>`).join('')}
                </tr>
              </tbody>
            </table>
          </div>
        </div>`;
    });

    document.getElementById('page-content').innerHTML = `
      <div class="grid-controls">
        <div class="month-nav">
          <button onclick="App.prevMonth();App.renderSynthese()">‹</button>
          <span>${formatMonthLabel(this.currentYear, this.currentMonth)}</span>
          <button onclick="App.nextMonth();App.renderSynthese()">›</button>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="App.exportAllCSV()">⬇ Export tout</button>
      </div>
      ${synthHtml || '<div class="alert alert-info">Aucune donnée pour cette période.</div>'}`;
  },

  exportSiteCSV(siteId) {
    const csv = DB.exportCSV(siteId, this.currentYear, this.currentMonth + 1);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pointage_${siteId}_${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}.csv`;
    a.click();
  },

  exportAllCSV() {
    DB.getSites().filter(s => s.actif).forEach(s => this.exportSiteCSV(s.id));
  },

  // ---- VALIDATION ----
  renderValidation() {
    const entries = DB.getPointage(
      this.canSeeGlobal() ? null : this.currentSite,
      this.currentYear, this.currentMonth + 1
    ).filter(p => !p.validated);

    const sites = DB.getSites();
    const emps = DB.getEmployees();

    const rows = entries.map(p => {
      const emp = emps.find(e => e.id === p.employee_id);
      const site = sites.find(s => s.id === p.site);
      const type = TYPES.find(t => t.key === p.type);
      return `
        <tr>
          <td>${site?.nom || p.site}</td>
          <td>${emp ? emp.prenom + ' ' + emp.nom : '—'}</td>
          <td>${emp?.poste || '—'}</td>
          <td>${p.date}</td>
          <td><span class="badge badge-${p.type}">${type?.label || p.type}</span></td>
          <td class="text-muted text-sm">${p.notes || '—'}</td>
          <td>${p.created_by} <span class="text-muted text-sm">${formatDateTime(p.created_at)}</span></td>
          <td>
            <button class="btn btn-success btn-xs" onclick="App.validateEntry('${p.id}')">✓ Valider</button>
          </td>
        </tr>`;
    }).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="grid-controls">
        <div class="month-nav">
          <button onclick="App.prevMonth();App.renderValidation()">‹</button>
          <span>${formatMonthLabel(this.currentYear, this.currentMonth)}</span>
          <button onclick="App.nextMonth();App.renderValidation()">›</button>
        </div>
        ${entries.length > 0 ? `<button class="btn btn-success btn-sm" onclick="App.validateAll()">✓ Tout valider</button>` : ''}
      </div>
      ${entries.length === 0 ? '<div class="alert alert-success">✓ Toutes les entrées de cette période sont validées.</div>' : ''}
      ${rows ? `
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr><th>Site</th><th>Collaborateur</th><th>Poste</th><th>Date</th><th>Type</th><th>Notes</th><th>Saisi par</th><th>Action</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>` : ''}`;
  },

  validateEntry(entryId) {
    DB.validateEntry(entryId, this.session);
    this.renderValidation();
  },

  validateAll() {
    if (!confirm('Valider toutes les entrées non validées de cette période ?')) return;
    const entries = DB.getPointage(null, this.currentYear, this.currentMonth + 1).filter(p => !p.validated);
    entries.forEach(p => DB.validateEntry(p.id, this.session));
    this.renderValidation();
  },

  // ---- COLLABORATEURS ----
  renderCollaborateurs() {
    const sites = DB.getSites().filter(s => s.actif);
    const employees = DB.getEmployees().filter(e => e.actif);

    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.openAddEmployee()">+ Nouveau collaborateur</button>`;

    const rows = employees.map(emp => {
      const site = DB.getSiteById(emp.site);
      return `
        <tr>
          <td class="text-muted text-sm">${emp.imm || '—'}</td>
          <td><strong>${emp.prenom} ${emp.nom}</strong></td>
          <td>${emp.poste}</td>
          <td>${site?.nom || emp.site}</td>
          <td class="text-muted text-sm">${emp.affectation || '—'}</td>
          <td>
            <button class="btn btn-ghost btn-xs" onclick="App.openEditEmployee('${emp.id}')">Modifier</button>
            <button class="btn btn-danger btn-xs" onclick="App.deleteEmployee('${emp.id}')">Supprimer</button>
          </td>
        </tr>`;
    }).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>N° IMM</th><th>Nom</th><th>Poste</th><th>Site</th><th>Affectation</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="text-muted">Aucun collaborateur.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  },

  _empFormHtml(emp = null) {
    const sites = DB.getSites().filter(s => s.actif);
    const affectations = DB.getAffectations();
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>N° Immatriculation</label><input id="emp-imm" type="text" value="${emp?.imm || ''}"></div>
        <div class="form-group">
          <label>Site</label>
          <select id="emp-site">
            ${sites.map(s => `<option value="${s.id}" ${s.id === emp?.site ? 'selected' : ''}>${s.nom}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Prénom</label><input id="emp-prenom" type="text" value="${emp?.prenom || ''}"></div>
        <div class="form-group"><label>Nom</label><input id="emp-nom" type="text" value="${emp?.nom || ''}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label>Poste</label>
          <select id="emp-poste">
            ${POSTES.map(p => `<option ${p === emp?.poste ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Affectation</label>
          <select id="emp-affectation">
            <option value="">— Aucune —</option>
            ${affectations.map(a => `<option ${a === emp?.affectation ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
      </div>`;
  },

  openAddEmployee() {
    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Nouveau collaborateur</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      ${this._empFormHtml()}
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveEmployee()">Enregistrer</button>
      </div>`);
  },

  openEditEmployee(id) {
    const emp = DB.getEmployees().find(e => e.id === id);
    if (!emp) return;
    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Modifier — ${emp.prenom} ${emp.nom}</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <input type="hidden" id="emp-id" value="${emp.id}">
      ${this._empFormHtml(emp)}
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveEmployee('${id}')">Enregistrer</button>
      </div>`);
  },

  saveEmployee(id = null) {
    const imm = document.getElementById('emp-imm').value.trim();
    const prenom = document.getElementById('emp-prenom').value.trim();
    const nom = document.getElementById('emp-nom').value.trim();
    const poste = document.getElementById('emp-poste').value;
    const site = document.getElementById('emp-site').value;
    const affectation = document.getElementById('emp-affectation').value;
    if (!prenom || !nom) { alert('Prénom et nom requis.'); return; }
    if (id) {
      DB.updateEmployee(id, { imm, prenom, nom, poste, site, affectation });
    } else {
      DB.addEmployee({ imm, prenom, nom, poste, site, affectation });
    }
    this.closeModal();
    this.renderCollaborateurs();
  },

  deleteEmployee(id) {
    if (!confirm('Supprimer ce collaborateur ? Ses pointages seront conservés.')) return;
    DB.updateEmployee(id, { actif: false });
    this.renderCollaborateurs();
  },

  // ---- SITES ----
  renderSites() {
    const sites = DB.getSites();

    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.openAddSite()">+ Nouveau site</button>`;

    const rows = sites.map(s => `
      <tr>
        <td><strong>${s.nom}</strong></td>
        <td>${s.ville}</td>
        <td><span class="badge ${s.actif ? 'badge-success' : 'badge-warning'}">${s.actif ? 'Actif' : 'Inactif'}</span></td>
        <td>
          <button class="btn btn-ghost btn-xs" onclick="App.toggleSite('${s.id}', ${!s.actif})">${s.actif ? 'Désactiver' : 'Activer'}</button>
        </td>
      </tr>`).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Nom</th><th>Ville</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  openAddSite() {
    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Nouveau site</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="form-group"><label>Nom du site</label><input id="site-nom" type="text" placeholder="Ex: Casablanca — Centre"></div>
      <div class="form-group"><label>Ville</label><input id="site-ville" type="text" placeholder="Ex: Casablanca"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveSite()">Enregistrer</button>
      </div>`);
  },

  saveSite() {
    const nom = document.getElementById('site-nom').value.trim();
    const ville = document.getElementById('site-ville').value.trim();
    if (!nom || !ville) { alert('Nom et ville requis.'); return; }
    DB.addSite({ nom, ville });
    this.closeModal();
    this.renderSites();
  },

  toggleSite(id, actif) {
    DB.updateSite(id, { actif });
    this.renderSites();
  },

  // ---- JOURS FÉRIÉS ----
  renderFeries() {
    const holidays = DB.getHolidays().sort((a, b) => a.date.localeCompare(b.date));

    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.openAddHoliday()">+ Ajouter</button>`;

    const rows = holidays.map(h => `
      <tr>
        <td>${h.date}</td>
        <td>${h.nom}</td>
        <td><button class="btn btn-danger btn-xs" onclick="App.deleteHoliday('${h.date}')">Supprimer</button></td>
      </tr>`).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Nom</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="text-muted">Aucun jour férié.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  },

  openAddHoliday() {
    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Ajouter un jour férié</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="form-group"><label>Date</label><input id="h-date" type="date"></div>
      <div class="form-group"><label>Nom</label><input id="h-nom" type="text" placeholder="Ex: Fête du Travail"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveHoliday()">Ajouter</button>
      </div>`);
  },

  saveHoliday() {
    const date = document.getElementById('h-date').value;
    const nom = document.getElementById('h-nom').value.trim();
    if (!date || !nom) { alert('Date et nom requis.'); return; }
    DB.addHoliday(date, nom);
    this.closeModal();
    this.renderFeries();
  },

  deleteHoliday(date) {
    if (!confirm('Supprimer ce jour férié ?')) return;
    DB.removeHoliday(date);
    this.renderFeries();
  },

  // ---- UTILISATEURS ----
  renderUtilisateurs() {
    const users = DB.getUsers();
    const sites = DB.getSites();

    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.openAddUser()">+ Nouvel utilisateur</button>`;

    const rows = users.map(u => {
      const site = u.site ? sites.find(s => s.id === u.site) : null;
      return `
        <tr>
          <td><strong>${u.username}</strong></td>
          <td>${u.nom}</td>
          <td><span class="badge badge-role">${ROLES[u.role] || u.role}</span></td>
          <td>${site ? site.nom : '— Tous —'}</td>
          <td>
            <button class="btn btn-ghost btn-xs" onclick="App.openChangePassword('${u.id}')">Changer MDP</button>
            ${u.id !== this.session.id ? `<button class="btn btn-danger btn-xs" onclick="App.deleteUser('${u.id}')">Supprimer</button>` : ''}
          </td>
        </tr>`;
    }).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="alert alert-warning">⚠ Les mots de passe sont stockés localement. Connectez une base de données pour un déploiement en production.</div>
      <div class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Site</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  openAddUser() {
    const sites = DB.getSites().filter(s => s.actif);
    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Nouvel utilisateur</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="form-group"><label>Identifiant</label><input id="u-username" type="text"></div>
      <div class="form-group"><label>Nom complet</label><input id="u-nom" type="text"></div>
      <div class="form-group"><label>Mot de passe</label><input id="u-password" type="password"></div>
      <div class="form-group">
        <label>Rôle</label>
        <select id="u-role" onchange="App.toggleSiteField(this.value)">
          <option value="cluster_ops">Cluster Ops Manager</option>
          <option value="juriste">Juriste</option>
          <option value="responsable_financier">Responsable Financier</option>
          <option value="kindness_ambassador">Kindness Ambassador</option>
        </select>
      </div>
      <div class="form-group" id="u-site-group" style="display:none">
        <label>Site assigné</label>
        <select id="u-site">
          ${sites.map(s => `<option value="${s.id}">${s.nom}</option>`).join('')}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveUser()">Enregistrer</button>
      </div>`);
  },

  toggleSiteField(role) {
    const group = document.getElementById('u-site-group');
    if (group) group.style.display = role === 'kindness_ambassador' ? '' : 'none';
  },

  saveUser() {
    const username = document.getElementById('u-username').value.trim();
    const nom = document.getElementById('u-nom').value.trim();
    const password = document.getElementById('u-password').value;
    const role = document.getElementById('u-role').value;
    const siteEl = document.getElementById('u-site');
    const site = role === 'kindness_ambassador' ? siteEl?.value : null;
    if (!username || !nom || !password) { alert('Tous les champs sont requis.'); return; }
    if (DB.getUsers().find(u => u.username === username)) { alert('Identifiant déjà utilisé.'); return; }
    DB.addUser({ username, nom, password, role, site });
    this.closeModal();
    this.renderUtilisateurs();
  },

  openChangePassword(userId) {
    this.showModal(`
      <div class="modal-header">
        <div class="modal-title">Changer le mot de passe</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="form-group"><label>Nouveau mot de passe</label><input id="new-pwd" type="password"></div>
      <div class="form-group"><label>Confirmer</label><input id="new-pwd2" type="password"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.savePassword('${userId}')">Enregistrer</button>
      </div>`);
  },

  savePassword(userId) {
    const p1 = document.getElementById('new-pwd').value;
    const p2 = document.getElementById('new-pwd2').value;
    if (!p1) { alert('Mot de passe requis.'); return; }
    if (p1 !== p2) { alert('Les mots de passe ne correspondent pas.'); return; }
    DB.updateUserPassword(userId, p1);
    this.closeModal();
    alert('Mot de passe modifié.');
  },

  deleteUser(userId) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    DB.deleteUser(userId);
    this.renderUtilisateurs();
  },

  // ---- AUDIT ----
  renderAudit() {
    const siteId = this.canSeeGlobal() ? null : this.currentSite;
    const log = DB.getAudit(siteId).reverse().slice(0, 200);
    const sites = DB.getSites();

    const actionIcons = {
      create: { icon: '+', cls: 'audit-create', label: 'Création' },
      update: { icon: '✎', cls: 'audit-update', label: 'Modification' },
      delete: { icon: '✕', cls: 'audit-delete', label: 'Suppression' },
      validate: { icon: '✓', cls: 'audit-validate', label: 'Validation' },
      lock: { icon: '🔒', cls: 'audit-lock', label: 'Verrouillage' },
      unlock: { icon: '🔓', cls: 'audit-lock', label: 'Déverrouillage' },
    };

    const items = log.map(entry => {
      const a = actionIcons[entry.action] || { icon: '?', cls: '', label: entry.action };
      const site = sites.find(s => s.id === entry.site);
      const oldV = entry.old_value ? `<br><span style="color:#999">Avant: ${JSON.stringify(entry.old_value)}</span>` : '';
      const newV = entry.new_value ? `<br><span>Après: ${JSON.stringify(entry.new_value)}</span>` : '';
      return `
        <div class="audit-item">
          <div class="audit-icon ${a.cls}">${a.icon}</div>
          <div class="audit-body">
            <strong>${a.label}</strong> — ID: ${entry.entry_id}
            ${site ? `&nbsp;· Site: ${site.nom}` : ''}
            ${oldV}${newV}
            <div class="audit-time">Par <strong>${entry.username}</strong> · ${formatDateTime(entry.timestamp)}</div>
          </div>
        </div>`;
    }).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 ${log.length} entrées récentes</div>
        </div>
        ${items || '<p class="text-muted">Aucune modification enregistrée.</p>'}
      </div>`;
  },

  // ---- VERROUS ----
  renderVerrous() {
    const sites = DB.getSites().filter(s => s.actif);
    const locks = DB.getLocks();

    const rows = sites.map(site => {
      const months = [];
      for (let i = 0; i < 12; i++) {
        const ym = `${this.currentYear}-${String(i + 1).padStart(2, '0')}`;
        const lock = locks.find(l => l.site === site.id && l.yearMonth === ym);
        months.push({ ym, lock, monthLabel: formatMonthLabel(this.currentYear, i) });
      }

      return `
        <div class="card">
          <div class="card-header">
            <div class="card-title">🏠 ${site.nom}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
            ${months.map(({ ym, lock, monthLabel }) => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">
                <span style="font-size:13px;font-weight:600">${monthLabel}</span>
                ${lock
                  ? `<span class="lock-indicator">🔒 ${lock.locked_by}
                      <button class="btn btn-xs" style="background:transparent;border:none;cursor:pointer;color:inherit" onclick="App.removeLock('${site.id}','${ym}')" title="Déverrouiller">✕</button>
                    </span>`
                  : `<button class="btn btn-ghost btn-xs" onclick="App.addLock('${site.id}','${ym}')">🔓 Verrouiller</button>`
                }
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    document.getElementById('page-content').innerHTML = `
      <div class="alert alert-info">Une période verrouillée empêche toute saisie ou modification. Seul le Cluster Ops Manager peut verrouiller/déverrouiller.</div>
      ${rows}`;
  },

  addLock(siteId, ym) {
    if (!confirm(`Verrouiller ${ym} pour ce site ? Aucune saisie ne sera possible.`)) return;
    DB.addLock(siteId, ym, this.session);
    this.renderVerrous();
  },

  removeLock(siteId, ym) {
    if (!confirm(`Déverrouiller ${ym} ?`)) return;
    DB.removeLock(siteId, ym, this.session);
    this.renderVerrous();
  },

  // ---- MODALES ----
  showModal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModal();
    });
    document.body.appendChild(overlay);
  },

  closeModal() {
    document.getElementById('modal-overlay')?.remove();
    this._saisieType = null;
  },

  // ---- DÉCONNEXION ----
  logout() {
    DB.clearSession();
    this.session = null;
    this.showLogin();
  },
};

// ---- Démarrage ----
document.addEventListener('DOMContentLoaded', () => App.init());
